import type { AuditEntryList, DisplayLocale, PlatformActor, SessionShell, TenantRole, TenantSettings } from '../../../../shared'
import type { TenantContext, TenantTransaction } from '../../../core/index'
import type { Membership } from './auth'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { z } from 'zod'
import { operationalDayStartHourSchema, parseTenantSettingsPatch, resolveDisplayLocale, sessionShellSchema, tenantRoleSchema } from '../../../../shared'
import { loadAppEnv, openTenantSession } from '../../../core/index'
import { listAuditEntries } from '../../audit'
import { createAuth } from './auth'
import { acceptInvitation, parseInviteInput, previewInvitation, repairInvitationCookies, sendInvitation } from './invitation'
import { mailerForApp } from './mailer'
import { changeMemberRole as changeMemberRoleImpl, parseChangeMemberRole, removeMember as removeMemberImpl } from './member-management'
import { changeTenantSettings, loadTenantSettings, TenantSettingsMissingError } from './tenant-settings'

/**
 * A session with no user is 401. A user with no single membership, or with
 * a role other than admin, dispatcher, or driver, is 403. ADR-0011: one
 * active organization and exactly one of those roles. A superadmin has no
 * membership and cannot mint a context.
 *
 * When the session has not set an active organization, the one membership
 * is the Tenant. Callers do not pass a tenant id.
 */
export class TenantAccessError extends Error {
  readonly statusCode: 401 | 403

  /**
   * Set when a signed-in user is refused, so a platform log can name the
   * actor without a second session read. Absent on 401.
   */
  readonly userId?: string

  constructor(statusCode: 401 | 403, userId?: string) {
    super(statusCode === 401 ? 'Unauthorized' : 'Forbidden')
    this.name = 'TenantAccessError'
    this.statusCode = statusCode
    this.userId = userId
  }
}

const sessionSchema = z.object({
  user: z.object({ id: z.string().min(1) }),
  session: z.object({
    activeOrganizationId: z.string().nullish(),
  }),
})

const settingsRows = z.object({
  rows: z.array(z.object({
    default_locale: z.string(),
    time_zone: z.string().min(1),
    operational_day_start_hour: z.number().int(),
  })),
})

interface Runtime {
  handle: ReturnType<typeof createAuth>
  db: ReturnType<typeof drizzle>
  appPool: pg.Pool
}

/**
 * The signed-in user in the session's active Tenant. `role` is that Tenant's
 * member row only; a role in another Tenant never applies here.
 */
export interface Actor {
  readonly context: TenantContext
  readonly userId: string
  readonly role: TenantRole
}

let runtime: Runtime | undefined

function tenantRuntime(): Runtime {
  if (runtime)
    return runtime
  const env = loadAppEnv()
  // App role. The tenant session sets app.tenant_id on this pool only.
  const appPool = new pg.Pool({ connectionString: env.DATABASE_URL })
  const mailer = mailerForApp(env)
  runtime = {
    handle: createAuth(env, { mailer }),
    appPool,
    db: drizzle(appPool),
  }
  return runtime
}

/** Closes the app and auth pools. Tests call this; the server keeps them. */
export async function closeTenantRuntime(): Promise<void> {
  const current = runtime
  runtime = undefined
  if (!current)
    return
  await current.handle.close()
  await current.appPool.end()
}

/** Better Auth's HTTP handler. The public sign-up route is disabled. */
export function handleAuthRequest(request: Request): Promise<Response> {
  return tenantRuntime().handle.auth.handler(request)
}

/**
 * Turn the session cookie into a TenantContext and run `run` inside
 * `openTenantSession`, so log lines in `run` carry `request_id` and `tenant_id`.
 * The request id is whatever the request hook already bound.
 */
export async function withTenantFromSession<T>(
  headers: Headers,
  run: (scope: { context: TenantContext, transaction: TenantTransaction, actor: Actor }) => Promise<T>,
): Promise<T> {
  const { handle, db } = tenantRuntime()
  const actor = await actorFromSession(handle, headers)
  return db.transaction(async (transaction) => {
    return openTenantSession(transaction, actor.context, () => run({ context: actor.context, transaction, actor }))
  })
}

/**
 * The sign-in address of one account, read by the auth role.
 * The same pool already looks up an invitation email. The app role
 * never selects auth.user. A missing account is null.
 */
export async function readSignInEmail(userId: string): Promise<string | null> {
  return tenantRuntime().handle.emailByUserId(userId)
}

/**
 * The signed-in shell. One tenant session, via `withTenantFromSession`.
 * The user's locale is read from auth.user; a null locale becomes
 * the Tenant `default_locale`. The time zone is display only.
 * userId is included so the UI can mark "you" in the member list.
 */
export async function readSessionShell(headers: Headers): Promise<SessionShell> {
  const { handle } = tenantRuntime()
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)

  // Auth role. The app role cannot read auth.user, and a null locale means the tenant default.
  const userLocale = await handle.userLocale(parsed.data.user.id)
  const memberships = await handle.memberships(parsed.data.user.id)

  return withTenantFromSession(headers, async ({ context, transaction }) => {
    const selected = settingsRows.parse(await transaction.execute(sql`
      select default_locale, time_zone, operational_day_start_hour from app.tenant_settings
    `))
    const settings = selected.rows.length === 1 ? selected.rows[0] : undefined
    if (!settings)
      throw new TenantSettingsMissingError()

    const membership = memberships.find(item => item.organizationId === context.tenantId)
    const role = tenantRoleSchema.safeParse(membership?.role)
    if (!role.success)
      throw new TenantAccessError(403)

    return sessionShellSchema.parse({
      tenantId: context.tenantId,
      tenantName: await handle.organizationName(context.tenantId),
      userId: parsed.data.user.id,
      locale: resolveDisplayLocale(userLocale, settings.default_locale),
      timeZone: settings.time_zone,
      operationalDayStartHour: operationalDayStartHourSchema.parse(settings.operational_day_start_hour),
      role: role.data,
    })
  })
}

const localeRows = z.object({
  rows: z.array(z.object({
    default_locale: z.enum(['hr', 'en']),
  })),
})

/**
 * Admin invite. The organization id comes from the tenant session, not the body.
 * The email uses the Tenant default locale.
 */
export async function inviteMember(headers: Headers, raw: unknown) {
  const input = parseInviteInput(raw)
  const { handle } = tenantRuntime()
  return withTenantFromSession(headers, async ({ context, transaction }) => {
    const selected = localeRows.parse(await transaction.execute(sql`
      select default_locale from app.tenant_settings
    `))
    const settings = selected.rows.length === 1 ? selected.rows[0] : undefined
    if (!settings)
      throw new TenantSettingsMissingError()
    return sendInvitation(handle, headers, {
      email: input.email,
      role: input.role,
      organizationId: context.tenantId,
      locale: settings.default_locale,
    })
  })
}

export async function previewMemberInvitation(raw: unknown, headers: Headers) {
  return previewInvitation(tenantRuntime().handle, raw, headers)
}

/** `key` is the client address. The limiter is the sign-in rule. */
export async function acceptMemberInvitation(raw: unknown, headers: Headers, key: string) {
  return acceptInvitation(tenantRuntime().handle, raw, headers, { key })
}

/**
 * The invitation routes send and clear the path-scoped session cookie.
 * Callers pass the repaired headers into Better Auth.
 */
export async function repairInvitationRequest(headers: Headers) {
  return repairInvitationCookies(tenantRuntime().handle, headers)
}

/**
 * List all members of the current Tenant. Visible to admin and dispatcher only.
 * Drivers get 403. The role is the one in the session's active Tenant, so a
 * driver there is refused even when another Tenant made them a dispatcher.
 * The email is not returned (it stays on auth.user).
 */
export async function listMembers(headers: Headers) {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    if (actor.role === 'driver')
      throw new TenantAccessError(403)
    const memberRows = z.object({
      rows: z.array(z.object({
        user_id: z.string(),
        name: z.string(),
        role: tenantRoleSchema,
      })),
    })
    const selected = memberRows.parse(await transaction.execute(sql`
      select user_id, name, role from app.tenant_member
      order by name
    `))
    return {
      members: selected.rows.map(row => ({
        userId: row.user_id,
        name: row.name,
        role: row.role,
      })),
    }
  })
}

/**
 * This Tenant's waits and time zone. Every Tenant role may read them.
 * ADR-0007: the Driver waits them out, and the Dispatcher may close a
 * No-show early. The values are Tenant policy, not another person's data.
 * Another Tenant sees nothing: `app.tenant_settings` has FORCE RLS.
 */
export async function readTenantSettings(headers: Headers): Promise<TenantSettings> {
  return withTenantFromSession(headers, async ({ transaction }) => loadTenantSettings(transaction))
}

/**
 * Change the waits, the time zone, or the operational-day start. Admin only; a dispatcher or a driver
 * is 403 before any update. The body is parsed first, so an invalid change
 * never opens a session. A patch that matches the row writes nothing.
 * Each field that does change appends one audit entry in this transaction.
 */
export async function updateTenantSettings(headers: Headers, raw: unknown): Promise<TenantSettings> {
  const patch = parseTenantSettingsPatch(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    if (actor.role !== 'admin')
      throw new TenantAccessError(403)
    return changeTenantSettings(transaction, actor.userId, patch)
  })
}

/**
 * This Tenant's audit entries, newest first. Admin only: a dispatcher or a
 * driver is 403. RLS limits the rows to the session's Tenant.
 */
export async function readAuditLog(headers: Headers): Promise<AuditEntryList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    if (actor.role !== 'admin')
      throw new TenantAccessError(403)
    return listAuditEntries(transaction)
  })
}

/**
 * Change a member's role. Admin of the session's Tenant only; member-management
 * checks the actor and re-reads the caller's role under the Tenant lock.
 * The last admin cannot be demoted. The change and its audit entry commit in
 * one auth-pool transaction, so no app-role transaction is opened.
 */
export async function changeMemberRole(
  headers: Headers,
  targetUserId: string,
  raw: unknown,
): Promise<void> {
  const { handle } = tenantRuntime()
  const { role } = parseChangeMemberRole(raw)
  const actor = await actorFromSession(handle, headers)
  await changeMemberRoleImpl(handle, actor, actor.context.tenantId, targetUserId, role)
}

/**
 * Remove a member from the Tenant. Admin of the session's Tenant only.
 * The last admin cannot be removed. Sessions tied to that member and this
 * Tenant are deleted in the same transaction as the membership.
 */
export async function removeTenantMember(
  headers: Headers,
  targetUserId: string,
): Promise<void> {
  const { handle } = tenantRuntime()
  const actor = await actorFromSession(handle, headers)
  await removeMemberImpl(handle, actor, actor.context.tenantId, targetUserId)
}

/**
 * Persists the user's locale on the auth user. Callers check the membership
 * first. This does not open a second tenant session. The public update-user
 * route cannot set this field (`input: false`).
 */
export async function updateUserLocale(headers: Headers, locale: DisplayLocale): Promise<void> {
  const { handle } = tenantRuntime()
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)
  await handle.setUserLocale(parsed.data.user.id, locale)
}

/**
 * One getSession and one memberships read per call. The context and the
 * role both come from the membership `chooseMembership` picks.
 */
/**
 * The platform gate. No session is 401. Any signed-in user who is not in
 * `platform.superadmin` is 403, before the caller looks at an organization id.
 * The result has no tenantId and is not a TenantContext.
 */
export async function platformActorFromSession(headers: Headers): Promise<PlatformActor> {
  const { handle } = tenantRuntime()
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)
  const userId = parsed.data.user.id
  if (!await handle.isSuperadmin(userId))
    throw new TenantAccessError(403, userId)
  return { userId }
}

/** The signed-in user's locale, or null when they have not chosen one. No tenant session. */
export async function readUserLocale(userId: string): Promise<string | null> {
  return tenantRuntime().handle.userLocale(userId)
}

async function actorFromSession(handle: Runtime['handle'], headers: Headers): Promise<Actor> {
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)

  const membership = chooseMembership(await handle.memberships(parsed.data.user.id), parsed.data.session.activeOrganizationId)
  // A deactivated firm fails closed on the next request. The session row stays.
  if (await handle.organizationSuspended(membership.organizationId))
    throw new TenantAccessError(403, parsed.data.user.id)
  return { context: { tenantId: membership.organizationId }, userId: parsed.data.user.id, role: membership.role }
}

function chooseMembership(
  memberships: readonly Membership[],
  activeOrganizationId: string | null | undefined,
): { organizationId: string, role: TenantRole } {
  if (memberships.length === 0)
    throw new TenantAccessError(403)

  const active = activeOrganizationId ? memberships.filter(member => member.organizationId === activeOrganizationId) : []
  const chosen = activeOrganizationId
    ? active
    : memberships.length === 1 ? memberships : []
  const membership = chosen.length === 1 ? chosen[0] : undefined
  if (!membership)
    throw new TenantAccessError(403)

  const parts = membership.role.split(',').map(part => part.trim()).filter(part => part !== '')
  const role = tenantRoleSchema.safeParse(parts[0])
  if (parts.length !== 1 || !role.success)
    throw new TenantAccessError(403)
  if (!z.uuid().safeParse(membership.organizationId).success)
    throw new TenantAccessError(403)
  return { organizationId: membership.organizationId, role: role.data }
}
