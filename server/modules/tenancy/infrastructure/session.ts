import type { DisplayLocale, SessionShell } from '../../../../shared'
import type { TenantContext, TenantTransaction } from '../../../core/index'
import type { Membership } from './auth'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { z } from 'zod'
import { resolveDisplayLocale, sessionShellSchema, tenantRoleSchema } from '../../../../shared'
import { loadAppEnv, openTenantSession } from '../../../core/index'
import { createAuth } from './auth'
import { acceptInvitation, parseInviteInput, previewInvitation, sendInvitation } from './invitation'
import { createResendMailer } from './mailer'
import { changeMemberRole as changeMemberRoleImpl, parseChangeMemberRole, removeMember as removeMemberImpl } from './member-management'

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

  constructor(statusCode: 401 | 403) {
    super(statusCode === 401 ? 'Unauthorized' : 'Forbidden')
    this.name = 'TenantAccessError'
    this.statusCode = statusCode
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
  })),
})

const ROLES = new Set(['admin', 'dispatcher', 'driver'])

interface Runtime {
  handle: ReturnType<typeof createAuth>
  db: ReturnType<typeof drizzle>
  appPool: pg.Pool
}

let runtime: Runtime | undefined

function tenantRuntime(): Runtime {
  if (runtime)
    return runtime
  const env = loadAppEnv()
  // App role. The tenant session sets app.tenant_id on this pool only.
  const appPool = new pg.Pool({ connectionString: env.DATABASE_URL })
  const mailer = env.RESEND_API_KEY === undefined ? undefined : createResendMailer(env.RESEND_API_KEY)
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
  run: (scope: { context: TenantContext, transaction: TenantTransaction }) => Promise<T>,
): Promise<T> {
  const { handle, db } = tenantRuntime()
  const context = await contextFromSession(handle, headers)
  return db.transaction(async (transaction) => {
    return openTenantSession(transaction, context, () => run({ context, transaction }))
  })
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
      select default_locale, time_zone from app.tenant_settings
    `))
    const settings = selected.rows.length === 1 ? selected.rows[0] : undefined
    if (!settings)
      throw new Error('Tenant settings are missing.')

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
      throw new Error('Tenant settings are missing.')
    return sendInvitation(handle, headers, {
      email: input.email,
      role: input.role,
      organizationId: context.tenantId,
      locale: settings.default_locale,
    })
  })
}

export async function previewMemberInvitation(raw: unknown) {
  return previewInvitation(tenantRuntime().handle, raw)
}

/** `key` is the client address. The limiter is the sign-in rule. */
export async function acceptMemberInvitation(raw: unknown, headers: Headers, key: string) {
  return acceptInvitation(tenantRuntime().handle, raw, headers, { key })
}

/**
 * List all members of the current Tenant. Visible to admin and dispatcher only.
 * Drivers get 403. The email is not returned (it stays on auth.user).
 */
export async function listMembers(headers: Headers) {
  // Check role before opening tenant session
  const { handle } = tenantRuntime()
  const session = await handle.auth.api.getSession({ headers })
  if (!session)
    throw new TenantAccessError(401)

  // Get the first membership to check the role
  // withTenantFromSession will validate the membership belongs to a valid tenant
  const memberships = await handle.memberships(session.user.id)
  if (memberships.length === 0)
    throw new TenantAccessError(401)

  // Check if any membership is driver-only (all memberships would have same role in single-tenant context)
  const hasDriverOnlyRole = memberships.every(m => m.role === 'driver')
  if (hasDriverOnlyRole)
    throw new TenantAccessError(403)

  return withTenantFromSession(headers, async ({ transaction }) => {
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
 * Change a member's role. Admin-only (Better Auth enforces this).
 * The last admin cannot be demoted.
 */
export async function changeMemberRole(
  headers: Headers,
  targetUserId: string,
  raw: unknown,
) {
  const { handle } = tenantRuntime()
  const { role } = parseChangeMemberRole(raw)
  return withTenantFromSession(headers, async ({ context }) => {
    await changeMemberRoleImpl(handle, headers, context.tenantId, targetUserId, role)
  })
}

/**
 * Remove a member from the Tenant. Admin-only (Better Auth enforces this).
 * The last admin cannot be removed. Sessions tied to that member and this
 * Tenant are revoked immediately.
 */
export async function removeTenantMember(
  headers: Headers,
  targetUserId: string,
) {
  const { handle } = tenantRuntime()
  return withTenantFromSession(headers, async ({ context }) => {
    await removeMemberImpl(handle, headers, context.tenantId, targetUserId)
  })
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

async function contextFromSession(
  handle: ReturnType<typeof createAuth>,
  headers: Headers,
): Promise<TenantContext> {
  const result = await handle.auth.api.getSession({ headers })
  if (!result)
    throw new TenantAccessError(401)
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)

  const memberships = await handle.memberships(parsed.data.user.id)
  const membership = chooseMembership(memberships, parsed.data.session.activeOrganizationId)
  return { tenantId: membership.organizationId }
}

function chooseMembership(
  memberships: readonly Membership[],
  activeOrganizationId: string | null | undefined,
): Membership {
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
  const role = parts[0]
  if (parts.length !== 1 || role === undefined || !ROLES.has(role))
    throw new TenantAccessError(403)
  if (!z.uuid().safeParse(membership.organizationId).success)
    throw new TenantAccessError(403)
  return membership
}
