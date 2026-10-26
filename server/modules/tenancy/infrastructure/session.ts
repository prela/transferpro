import type { AuditEntryList, DisplayLocale, InvitationMailOutcome, InviteResult, PlatformActor, SessionShell, TenantRole, TenantSettings } from '../../../../shared'
import type { TenantContext, TenantTransaction } from '../../../core/index'
import type { Membership } from './auth'
import type { InvitationMail } from './mailer'
import process from 'node:process'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { z } from 'zod'
import { inviteLink, inviteResultSchema, memberListSchema, memberSessionCapMs, operationalDayStartHourSchema, parseTenantSettingsPatch, resolveDisplayLocale, sessionShellSchema, TENANT_CHANGED, tenantChoiceListSchema, tenantRoleSchema } from '../../../../shared'
import { getLogger, loadAppEnv, openTenantSession } from '../../../core/index'
import { listAuditEntries } from '../../audit'
import { createAuth } from './auth'
import { askHoldingRide } from './holding-ride'
import { acceptInvitation, createInvitation, parseInviteInput, previewInvitation, listPendingInvitations as readPendingInvitations, repairInvitationCookies, revokePendingInvitation as revokePendingInvitationImpl } from './invitation'
import { mailerForApp, ResendTransportError } from './mailer'
import { changeMemberRole as changeMemberRoleImpl, parseChangeMemberRole, removeMember as removeMemberImpl } from './member-management'
import { changeTenantSettings, loadTenantSettings, TenantSettingsMissingError } from './tenant-settings'

/**
 * A session with no user is 401. No working membership, a role other than
 * admin, dispatcher, or driver, or an active membership that was removed or
 * whose Tenant was deactivated, is 403. ADR-0011: one active organization
 * and exactly one of those roles. A superadmin has no membership and cannot
 * mint a context.
 *
 * Two or more working memberships and no active organization is 409. That
 * is the gate, not no-access: the caller lists the companies and the person
 * chooses. Nothing here stores a last Tenant. Callers do not pass a tenant id
 * except that choice.
 */
/**
 * The office screen was opened for a different Tenant than the one this
 * session now has, or the screen did not say which Tenant it was opened for.
 * Nothing is written: the throw happens before the tenant transaction.
 * `data.code` is what the HTTP error handler copies into the JSON body.
 */
export class TenantChangedError extends Error {
  readonly statusCode = 409
  readonly code = TENANT_CHANGED
  readonly data = { code: TENANT_CHANGED }

  constructor() {
    super('Conflict')
    this.name = 'TenantChangedError'
  }
}

/**
 * Vitest and the e2e server omit the claim on fixture writes. That claim
 * means "the session's own Tenant", which is the only Tenant those callers
 * can see. Production never uses it. A screen that forgot the claim is a
 * mismatch, not this.
 */
const sessionTenantClaim = Symbol('session-tenant')

export interface OfficeWriteClaim {
  readonly expectedTenantId: unknown
  /**
   * The body had `expectedTenantId`, or the request set `x-expected-tenant-id`.
   * An explicit claim is compared before the body is parsed, so a stale
   * screen is 409 even when the rest of the body would have been 400.
   */
  readonly explicit: boolean
  /** The body with `expectedTenantId` removed, so a strict schema still parses. */
  readonly body: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Vite replaces a direct `process.env.NODE_ENV` with `"production"` in the
 * built server. The e2e server still sets NODE_ENV to test at process start,
 * so the hatch has to read the variable at call time.
 */
function currentNodeEnv(): string {
  const key = 'NODE_ENV'
  return process.env[key] ?? ''
}

/**
 * The Tenant the office screen was opened for.
 * The JSON field wins. The header is the same claim for a route whose body
 * is not the form, and for a test that sets the header to empty to mean
 * "the screen sent nothing". Under `NODE_ENV=test` only, neither one means
 * the session Tenant. Any other environment treats that as a missing claim.
 */
export function officeWriteClaim(headers: Headers, raw: unknown, nodeEnv: string = currentNodeEnv()): OfficeWriteClaim {
  const record = isRecord(raw) ? raw : undefined
  const present = record !== undefined && 'expectedTenantId' in record
  const body = present
    ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'expectedTenantId'))
    : raw
  const header = headers.get('x-expected-tenant-id')
  const explicit = present || header !== null
  if (present)
    return { expectedTenantId: record.expectedTenantId, explicit, body }
  if (header !== null)
    return { expectedTenantId: header, explicit, body }
  if (nodeEnv === 'test')
    return { expectedTenantId: sessionTenantClaim, explicit: false, body }
  return { expectedTenantId: undefined, explicit: false, body }
}

/**
 * Refuse before any tenant transaction. A missing claim and a claim for
 * another Tenant are the same 409. The session Tenant is the one just read
 * from the cookie, not a tenant id in the body.
 */
export function assertExpectedTenant(activeTenantId: string, expectedTenantId: unknown): void {
  const expected = expectedTenantId === sessionTenantClaim ? activeTenantId : expectedTenantId
  const parsed = z.uuid().safeParse(expected)
  if (!parsed.success || parsed.data !== activeTenantId)
    throw new TenantChangedError()
}

async function refuseStaleTenant(headers: Headers, claim: OfficeWriteClaim): Promise<void> {
  const actor = await actorFromSession(tenantRuntime().handle, headers)
  assertExpectedTenant(actor.context.tenantId, claim.expectedTenantId)
}

export class TenantAccessError extends Error {
  readonly statusCode: 401 | 403 | 409

  /**
   * Set when a signed-in user is refused, so a platform log can name the
   * actor without a second session read. Absent on 401.
   */
  readonly userId?: string

  constructor(statusCode: 401 | 403 | 409, userId?: string) {
    super(statusCode === 401 ? 'Unauthorized' : statusCode === 409 ? 'Conflict' : 'Forbidden')
    this.name = 'TenantAccessError'
    this.statusCode = statusCode
    this.userId = userId
  }
}

const sessionSchema = z.object({
  user: z.object({ id: z.string().min(1) }),
  session: z.object({
    id: z.string().min(1),
    createdAt: z.coerce.date(),
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
  /**
   * Present when this actor was read from a session. A constructed actor
   * used by a command does not carry the clock.
   */
  readonly signedInAt?: Date
  readonly sessionEndsAt?: Date
  readonly holdingRide?: boolean
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
  claim?: Pick<OfficeWriteClaim, 'expectedTenantId'>,
): Promise<T> {
  const { handle, db } = tenantRuntime()
  const actor = await actorFromSession(handle, headers)
  // Reads omit the claim. A write passes one, and a mismatch throws here,
  // before the transaction that would insert a row or an audit entry.
  if (claim)
    assertExpectedTenant(actor.context.tenantId, claim.expectedTenantId)
  return db.transaction(async (transaction) => {
    return openTenantSession(transaction, actor.context, () => run({ context: actor.context, transaction, actor }))
  })
}

/**
 * One office write. An explicit claim is compared before `parse`, so a stale
 * screen does not depend on the rest of the body being valid. `parse` still
 * runs before the tenant transaction when the claim is not explicit, which
 * is how an invalid fixture body stays 400 without a session. The transaction
 * then compares again, so a write cannot skip the check.
 */
export async function withOfficeWrite<I, T>(
  headers: Headers,
  raw: unknown,
  parse: (body: unknown) => I,
  run: (scope: { context: TenantContext, transaction: TenantTransaction, actor: Actor }, input: I) => Promise<T>,
): Promise<T> {
  const office = officeWriteClaim(headers, raw)
  if (office.explicit)
    await refuseStaleTenant(headers, office)
  const input = parse(office.body)
  return withTenantFromSession(headers, scope => run(scope, input), office)
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

  return withTenantFromSession(headers, async ({ context, transaction, actor }) => {
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
    if (!actor.signedInAt || !actor.sessionEndsAt || actor.holdingRide === undefined)
      throw new TenantAccessError(401, actor.userId)

    // Name and email stay out of logs. They exist so the profile menu can
    // name the signed-in account (ADR-0038).
    const identity = await handle.accountIdentity(parsed.data.user.id)
    return sessionShellSchema.parse({
      tenantId: context.tenantId,
      tenantName: await handle.organizationName(context.tenantId),
      userId: parsed.data.user.id,
      userName: identity.name,
      email: identity.email,
      locale: resolveDisplayLocale(userLocale, settings.default_locale),
      timeZone: settings.time_zone,
      operationalDayStartHour: operationalDayStartHourSchema.parse(settings.operational_day_start_hour),
      role: role.data,
      signedInAt: actor.signedInAt.toISOString(),
      sessionEndsAt: actor.sessionEndsAt.toISOString(),
      holdingRide: actor.holdingRide,
    })
  })
}

const localeRows = z.object({
  rows: z.array(z.object({
    default_locale: z.enum(['hr', 'en']),
  })),
})

/**
 * The invite call's mail (ADR-0045). The mail module implements this and
 * the route passes it in: the mail module imports this one, not the other
 * way round. `open` runs `run` on a new tenant transaction for the inviting
 * Tenant. The outcome is what the Admin is told. The id never leaves it.
 */
export interface InvitationMailPort {
  deliver: (input: {
    readonly context: TenantContext
    readonly invitationId: string
    readonly open: <T>(run: (transaction: TenantTransaction) => Promise<T>) => Promise<T>
  }) => Promise<InvitationMailOutcome>
}

/**
 * Admin invite. The organization id comes from the tenant session, not the body.
 * The route checks the role itself, and Better Auth checks it again.
 * Better Auth's invitation is on the auth pool and the outbox entry is on the
 * app pool, so neither shares a transaction with the other (ADR-0047). The
 * tenant transaction commits before Better Auth is called, and the mail runs
 * after Better Auth commits. The link is always returned.
 */
export async function inviteMember(headers: Headers, raw: unknown, outbox: InvitationMailPort): Promise<InviteResult> {
  const { handle, db } = tenantRuntime()
  const prepared = await withOfficeWrite(headers, raw, parseInviteInput, async ({ context, actor, transaction }, input) => {
    if (actor.role !== 'admin')
      throw new TenantAccessError(403, actor.userId)
    // Every attempt composes in the Tenant default locale. A Tenant with no
    // settings row would leave an entry that can never be composed.
    const selected = localeRows.parse(await transaction.execute(sql`
      select default_locale from app.tenant_settings
    `))
    if (selected.rows.length !== 1)
      throw new TenantSettingsMissingError()
    return { context, input }
  })
  const { context, input } = prepared
  const invitationId = await createInvitation(handle, headers, {
    email: input.email,
    role: input.role,
    organizationId: context.tenantId,
  })
  let mail: InvitationMailOutcome
  try {
    mail = await outbox.deliver({
      context,
      invitationId,
      open: run => db.transaction(transaction => openTenantSession(transaction, context, () => run(transaction))),
    })
  }
  catch (error) {
    // The test server must not keep a live Resend transport running.
    if (error instanceof ResendTransportError)
      throw error
    // The invitation exists. A port that failed before it could decide
    // anything must not hide the link. Nothing will retry this mail.
    mail = 'not_sent'
    // No id and no email: the id is a bearer secret. A missing logger must
    // not turn a created invitation into a 500.
    try {
      getLogger().warn({ event: 'mail_outbox.invitation_not_recorded' })
    }
    catch {}
  }
  return inviteResultSchema.parse({ inviteUrl: inviteLink(handle.baseURL, invitationId), mail })
}

/**
 * One invitation as its mail needs it. `mail` has no locale: the outbox
 * reads the Tenant default on its own transaction. Null `mail` is a role
 * outside the Tenant roles, which cannot be composed.
 */
export interface InvitationForMail {
  readonly status: string
  readonly expiresAt: Date
  readonly mail: Omit<InvitationMail, 'locale' | 'idempotencyKey'> | null
}

/**
 * Read by the auth role, limited to `tenantId`, which the caller takes from
 * the session or the job envelope. Null when this Tenant has no such
 * invitation. The address and the link are bearer material: do not log them.
 * No role check: the worker has no actor. HTTP use is the worker-used loader list (#344).
 */
export async function readInvitationForMail(tenantId: string, invitationId: string): Promise<InvitationForMail | null> {
  const { handle } = tenantRuntime()
  const record = await handle.invitationForMail(tenantId, invitationId)
  if (record === null)
    return null
  const role = tenantRoleSchema.safeParse(record.role)
  return {
    status: record.status,
    expiresAt: record.expiresAt,
    mail: role.success
      ? { to: record.email, inviteUrl: inviteLink(handle.baseURL, invitationId), role: role.data, tenantName: record.tenantName }
      : null,
  }
}

/**
 * Invitee addresses for ids the caller's tenant session already listed,
 * keyed by invitation id. Admin only, checked here so no caller can skip it.
 * The app role cannot read them. Do not log the result.
 */
export async function readInvitationEmails(viewer: Pick<Actor, 'context' | 'role'>, invitationIds: readonly string[]): Promise<Map<string, string>> {
  if (viewer.role !== 'admin')
    throw new TenantAccessError(403)
  return tenantRuntime().handle.invitationEmailsById(viewer.context.tenantId, invitationIds)
}

/**
 * Pending invitations for the session's Tenant. Admin only. A dispatcher
 * or a driver is 403 before Better Auth is called, because its list is
 * open to every member. The organization id is the session's, so a query
 * cannot name another Tenant.
 */
export async function listPendingInvitations(headers: Headers) {
  const { handle } = tenantRuntime()
  const actor = await actorFromSession(handle, headers)
  if (actor.role !== 'admin')
    throw new TenantAccessError(403)
  return readPendingInvitations(handle, headers, actor.context.tenantId)
}

/**
 * Revoke one pending invitation of the session's Tenant. Admin only.
 * Another Tenant's id is 404, the same as an id that is not there.
 */
export async function revokePendingInvitation(headers: Headers, invitationId: string, raw?: unknown): Promise<void> {
  const office = officeWriteClaim(headers, raw)
  const { handle } = tenantRuntime()
  const actor = await actorFromSession(handle, headers)
  assertExpectedTenant(actor.context.tenantId, office.expectedTenantId)
  if (actor.role !== 'admin')
    throw new TenantAccessError(403)
  await revokePendingInvitationImpl(handle, headers, actor.context.tenantId, actor.userId, invitationId)
}

export async function previewMemberInvitation(raw: unknown, headers: Headers) {
  const { handle } = tenantRuntime()
  // A stale driver cookie must not count as the invited account.
  // The preview stays public: the row is gone, so this read is signed out.
  await refuseStaleMember(handle, headers).catch((error: unknown) => {
    if (error instanceof TenantAccessError && error.statusCode === 401)
      return
    throw error
  })
  return previewInvitation(handle, raw, headers)
}

/** `key` is the client address. The limiter is the sign-in rule. */
export async function acceptMemberInvitation(raw: unknown, headers: Headers, key: string) {
  const { handle } = tenantRuntime()
  await refuseStaleMember(handle, headers)
  return acceptInvitation(handle, raw, headers, { key })
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
 * Names and roles come from the app view, which has no email. An Admin read
 * then loads the sign-in address from the auth role, and only for those user
 * ids. A Dispatcher list stays without it: the Drivers catalog does not show it.
 */
export async function listMembers(headers: Headers) {
  const { handle } = tenantRuntime()
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
    const emails = actor.role === 'admin'
      ? await handle.emailsByUserId(selected.rows.map(row => row.user_id))
      : null
    return memberListSchema.parse({
      members: selected.rows.map((row) => {
        const member = {
          userId: row.user_id,
          name: row.name,
          role: row.role,
        }
        if (emails === null)
          return member
        const email = emails.get(row.user_id)
        // A member row without an account cannot be shown. The message has no address.
        if (email === undefined)
          throw new Error('Member email is missing.')
        return { ...member, email }
      }),
    })
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
  return withOfficeWrite(headers, raw, parseTenantSettingsPatch, async ({ actor, transaction }, patch) => {
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
  const office = officeWriteClaim(headers, raw)
  if (office.explicit)
    await refuseStaleTenant(headers, office)
  const { role } = parseChangeMemberRole(office.body)
  const { handle } = tenantRuntime()
  const actor = await actorFromSession(handle, headers)
  assertExpectedTenant(actor.context.tenantId, office.expectedTenantId)
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
  raw?: unknown,
): Promise<void> {
  const office = officeWriteClaim(headers, raw)
  const { handle } = tenantRuntime()
  const actor = await actorFromSession(handle, headers)
  assertExpectedTenant(actor.context.tenantId, office.expectedTenantId)
  await removeMemberImpl(handle, actor, actor.context.tenantId, targetUserId)
}

/**
 * Persists the user's locale on the auth user. Callers check the membership
 * first. This does not open a second tenant session. The public update-user
 * route cannot set this field (`input: false`).
 */
export async function updateUserLocale(headers: Headers, locale: DisplayLocale): Promise<void> {
  const { handle } = tenantRuntime()
  const userId = await liveUserId(handle, headers)
  await handle.setUserLocale(userId, locale)
}

/**
 * The platform gate. No session is 401. Any signed-in user who is not in
 * `platform.superadmin` is 403, before the caller looks at an organization id.
 * The result has no tenantId and is not a TenantContext.
 */
export async function platformActorFromSession(headers: Headers): Promise<PlatformActor> {
  const { handle } = tenantRuntime()
  const userId = await liveUserId(handle, headers)
  if (!await handle.isSuperadmin(userId))
    throw new TenantAccessError(403, userId)
  return { userId }
}

/** The signed-in user's locale, or null when they have not chosen one. No tenant session. */
export async function readUserLocale(userId: string): Promise<string | null> {
  return tenantRuntime().handle.userLocale(userId)
}

/**
 * The signed-in account's name and email. The caller shows them in the
 * profile menu and does not log them.
 */
export async function readAccountIdentity(userId: string): Promise<{ name: string, email: string }> {
  return tenantRuntime().handle.accountIdentity(userId)
}

/**
 * Companies the signed-in person can open. A deactivated Tenant is absent.
 * This does not open a tenant session and does not return Tenant data.
 * The gate reads it when the shell is 409. A session that already has an
 * active Tenant does not show that gate.
 */
export async function listTenantChoices(headers: Headers) {
  const { handle } = tenantRuntime()
  const userId = await signedInUserId(handle, headers)
  const working = await workingMemberships(handle, userId)
  const choices = await Promise.all(working.map(async (membership) => {
    return {
      tenantId: membership.organizationId,
      tenantName: await handle.organizationName(membership.organizationId),
      role: membership.role,
    }
  }))
  choices.sort((left, right) => left.tenantName.localeCompare(right.tenantName, 'hr'))
  return tenantChoiceListSchema.parse({ choices })
}

/**
 * Sets the active Tenant on this session only. A company that is not a
 * working membership is refused, including a deactivated Tenant. The user
 * row is not updated: the next sign-in does not restore this choice.
 * A session that already has a company does not switch here.
 */
export async function chooseActiveTenant(headers: Headers, tenantId: string): Promise<void> {
  const { handle } = tenantRuntime()
  const signedIn = await signedInSession(handle, headers)
  if (signedIn.activeOrganizationId)
    throw new TenantAccessError(403, signedIn.userId)
  await activateWorkingTenant(handle, headers, signedIn.userId, tenantId)
}

/**
 * The profile menu changes the active Tenant without signing out (ADR-0056).
 * The gate is the only path when the session has not chosen. A removed or
 * deactivated active membership stays no-access. A company that is not a
 * working membership is refused, and nothing stores the choice on the user.
 */
export async function switchActiveTenant(headers: Headers, tenantId: string): Promise<void> {
  const { handle } = tenantRuntime()
  const signedIn = await signedInSession(handle, headers)
  if (!signedIn.activeOrganizationId)
    throw new TenantAccessError(403, signedIn.userId)
  const working = await workingMemberships(handle, signedIn.userId)
  const current = working.find(membership => membership.organizationId === signedIn.activeOrganizationId)
  if (!current)
    throw new TenantAccessError(403, signedIn.userId)
  if (current.organizationId === tenantId)
    return
  await activateWorkingTenant(handle, headers, signedIn.userId, tenantId, working)
}

async function activateWorkingTenant(
  handle: Runtime['handle'],
  headers: Headers,
  userId: string,
  tenantId: string,
  working?: { organizationId: string, role: TenantRole }[],
): Promise<void> {
  const memberships = working ?? await workingMemberships(handle, userId)
  if (!memberships.some(membership => membership.organizationId === tenantId))
    throw new TenantAccessError(403, userId)
  try {
    await handle.auth.api.setActiveOrganization({
      headers,
      body: { organizationId: tenantId },
    })
  }
  catch {
    const still = await handle.auth.api.getSession({ headers }).catch(() => null)
    if (!sessionSchema.safeParse(still).success)
      throw new TenantAccessError(401, userId)
    throw new TenantAccessError(403, userId)
  }
  // Switching into an office membership after twelve hours ends the session.
  // actorFromSession deletes the row when the new cap is already past.
  await actorFromSession(handle, headers)
}

async function signedInUserId(handle: Runtime['handle'], headers: Headers): Promise<string> {
  return (await signedInSession(handle, headers)).userId
}

async function signedInSession(
  handle: Runtime['handle'],
  headers: Headers,
): Promise<{ userId: string, activeOrganizationId: string | null | undefined }> {
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)
  await liveOrDelete(handle, parsed.data)
  return {
    userId: parsed.data.user.id,
    activeOrganizationId: parsed.data.session.activeOrganizationId,
  }
}

/**
 * No session stays no session. A member past the active cap is deleted,
 * so the next read is signed out. A platform owner is left to the
 * eight-hour row.
 */
async function refuseStaleMember(handle: Runtime['handle'], headers: Headers): Promise<void> {
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    return
  await liveOrDelete(handle, parsed.data)
}

/** The signed-in user, after the member cap. No session is 401. */
async function liveUserId(handle: Runtime['handle'], headers: Headers): Promise<string> {
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)
  await liveOrDelete(handle, parsed.data)
  return parsed.data.user.id
}

async function liveOrDelete(
  handle: Runtime['handle'],
  session: { user: { id: string }, session: { id: string, createdAt: Date, activeOrganizationId?: string | null } },
): Promise<void> {
  if (await handle.isSuperadmin(session.user.id))
    return
  const cap = await roleForCap(handle, session.user.id, session.session.activeOrganizationId)
  await memberLifetime(handle, session.user.id, cap.role, cap.tenantId, session.session)
}

/**
 * The cap is the active membership. One company and none active uses that
 * role, so a sole Driver is still asked about a holding Ride. No company,
 * or two and none active, is the twelve-hour office cap: the row already
 * expires then.
 */
async function roleForCap(
  handle: Runtime['handle'],
  userId: string,
  activeOrganizationId: string | null | undefined,
): Promise<{ role: TenantRole, tenantId: string }> {
  const memberships = await readableMemberships(handle, userId)
  const active = activeOrganizationId
    ? memberships.find(membership => membership.organizationId === activeOrganizationId)
    : undefined
  if (active)
    return { role: active.role, tenantId: active.organizationId }
  const only = !activeOrganizationId && memberships.length === 1 ? memberships[0] : undefined
  if (only)
    return { role: only.role, tenantId: only.organizationId }
  return { role: 'admin', tenantId: activeOrganizationId ?? '' }
}

async function actorFromSession(handle: Runtime['handle'], headers: Headers): Promise<Actor> {
  const result = await handle.auth.api.getSession({ headers })
  const parsed = sessionSchema.safeParse(result)
  if (!parsed.success)
    throw new TenantAccessError(401)

  const userId = parsed.data.user.id
  const membership = await resolveMembership(handle, userId, parsed.data.session.activeOrganizationId)
  const lifetime = await memberLifetime(handle, userId, membership.role, membership.organizationId, parsed.data.session)
  return {
    context: { tenantId: membership.organizationId },
    userId,
    role: membership.role,
    ...lifetime,
  }
}

/**
 * The active membership's cap, from this sign-in. A Driver past twelve
 * hours stays only while a Ride in this Tenant holds the session, and
 * never past sixteen. The row is deleted so the next read is signed out.
 */
async function memberLifetime(
  handle: Runtime['handle'],
  userId: string,
  role: TenantRole,
  tenantId: string,
  session: { id: string, createdAt: Date },
): Promise<{ signedInAt: Date, sessionEndsAt: Date, holdingRide: boolean }> {
  const now = new Date()
  const holdingRide = role === 'driver'
    ? await askHoldingRide({ tenantId, userId, now })
    : false
  const sessionEndsAt = new Date(session.createdAt.getTime() + memberSessionCapMs(role, holdingRide))
  if (now.getTime() >= sessionEndsAt.getTime()) {
    await handle.deleteSession(session.id)
    throw new TenantAccessError(401, userId)
  }
  return { signedInAt: session.createdAt, sessionEndsAt, holdingRide }
}

/**
 * The active organization wins when it is still a working membership.
 * A removed or deactivated active membership stays 403 until sign-out:
 * the gate is only for a session that has not chosen. One working
 * membership opens that company. Two or more, with nothing active, is 409.
 */
async function resolveMembership(
  handle: Runtime['handle'],
  userId: string,
  activeOrganizationId: string | null | undefined,
): Promise<{ organizationId: string, role: TenantRole }> {
  if (activeOrganizationId) {
    const memberships = await readableMemberships(handle, userId)
    const active = memberships.find(membership => membership.organizationId === activeOrganizationId)
    // Not a member of the active company, or the role is not a Tenant role.
    if (!active)
      throw new TenantAccessError(403)
    // The session row stays. The next sign-in follows the gate.
    if (await handle.organizationSuspended(active.organizationId))
      throw new TenantAccessError(403, userId)
    return active
  }

  const working = await workingMemberships(handle, userId)
  const only = working.length === 1 ? working[0] : undefined
  if (only)
    return only
  if (working.length === 0)
    throw new TenantAccessError(403)
  throw new TenantAccessError(409, userId)
}

async function workingMemberships(
  handle: Runtime['handle'],
  userId: string,
): Promise<{ organizationId: string, role: TenantRole }[]> {
  const memberships = await readableMemberships(handle, userId)
  const working: { organizationId: string, role: TenantRole }[] = []
  for (const membership of memberships) {
    if (await handle.organizationSuspended(membership.organizationId))
      continue
    working.push(membership)
  }
  return working
}

/** Memberships whose role is exactly one Tenant role. A second role is still refused. */
async function readableMemberships(
  handle: Runtime['handle'],
  userId: string,
): Promise<{ organizationId: string, role: TenantRole }[]> {
  const rows = await handle.memberships(userId)
  return rows.flatMap((membership) => {
    const parsed = oneTenantRole(membership)
    return parsed ? [parsed] : []
  })
}

function oneTenantRole(membership: Membership): { organizationId: string, role: TenantRole } | undefined {
  const parts = membership.role.split(',').map(part => part.trim()).filter(part => part !== '')
  const role = tenantRoleSchema.safeParse(parts[0])
  if (parts.length !== 1 || !role.success)
    return undefined
  if (!z.uuid().safeParse(membership.organizationId).success)
    return undefined
  return { organizationId: membership.organizationId, role: role.data }
}
