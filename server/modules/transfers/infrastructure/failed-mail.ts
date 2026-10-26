import type { OfficeHome, TenantRole } from '../../../../shared'
import type { Logger, TenantContext, TenantTransaction } from '../../../core/index'
import type { FailedMailResendStore, OutboxKind } from '../../mail'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { failedMailResendSchema, tenantRoleSchema, WORK_ORDER_STATUSES } from '../../../../shared'
import { getLogger, hideDatabaseError, loadAppEnv } from '../../../core/index'
import { failedWorkOrderMatters, invitationIsCurrent, loadInvitationAttempt, readOutboxKind, resendFailedOutboxEntry, settleFailedOutboxEntry } from '../../mail'
import { mailerForApp, officeWriteClaim, readInvitationEmails, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { toInstant } from './transfers'
import { loadOutboxAttempt } from './work-order-attempt'

type FailedMail = OfficeHome['failedMails'][number]
type FailedWorkOrder = Extract<FailedMail, { kind: 'work_order' }>
type FailedInvitation = Extract<FailedMail, { kind: 'invitation' }>

/**
 * The id is not a failed work order in this Tenant, or it is no longer failed.
 * Another Tenant's id is this same error: the row is invisible under RLS.
 */
export class FailedMailNotFoundError extends Error {
  readonly statusCode = 404 as const

  constructor() {
    super('Failed mail was not found.')
    this.name = 'FailedMailNotFoundError'
  }
}

/** The id or the body is not the empty resend this route accepts. */
export class FailedMailInputError extends Error {
  readonly statusCode = 400 as const

  constructor() {
    super('Failed mail input is not valid.')
    this.name = 'FailedMailInputError'
  }
}

const failedRowSchema = z.object({
  entryId: z.uuid(),
  driverId: z.uuid(),
  status: z.enum(WORK_ORDER_STATUSES),
  rideState: z.string(),
  superseded: z.boolean(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
})

/**
 * Failed work orders for the Home read. The `state = 'failed'` literal is
 * what lets the partial index answer the 60-second refresh. Kind is
 * work order only: failed invitations have their own query. The address is not
 * selected. A newer work order for the same Ride and the same Driver is
 * `superseded`. Rows from one transaction share `created_at` and do not
 * replace each other.
 */
export function failedWorkOrdersQuery() {
  return sql`
    select
      o.id as "entryId",
      o.driver_id as "driverId",
      o.work_order_status as "status",
      r.state as "rideState",
      exists (
        select 1
        from app.mail_outbox as newer
        where newer.tenant_id = o.tenant_id
          and newer.ride_id = o.ride_id
          and newer.driver_id = o.driver_id
          and newer.kind = 'work_order'
          and newer.created_at > o.created_at
      ) as "superseded",
      t.pickup_at as "pickupAt",
      t.start_location_id as "startLocationId",
      t.end_location_id as "endLocationId"
    from app.mail_outbox as o
    join app.rides as r
      on r.id = o.ride_id and r.tenant_id = o.tenant_id
    join app.transfers as t
      on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where o.kind = 'work_order'
      and o.state = 'failed'
  `
}

/**
 * Failed work orders that still matter, soonest pickup first.
 * Names come from the catalogs the Home read already loaded. Nothing is written.
 * A missing Driver or place fails the whole snapshot, the same way a Ride does.
 */
export async function loadFailedWorkOrders(
  transaction: TenantTransaction,
  drivers: Map<string, string>,
  places: Map<string, string>,
): Promise<FailedWorkOrder[]> {
  const selected = z.object({ rows: z.array(failedRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(failedWorkOrdersQuery()),
    'Office home read failed',
  ))
  const listed: FailedWorkOrder[] = []
  for (const row of selected.rows) {
    if (!failedWorkOrderMatters(row))
      continue
    const start = places.get(row.startLocationId)
    const end = places.get(row.endLocationId)
    const driverName = drivers.get(row.driverId)
    if (start === undefined || end === undefined || driverName === undefined)
      throw new Error('Office home read failed')
    listed.push({
      kind: 'work_order',
      entryId: row.entryId,
      driverName,
      pickupAt: toInstant(row.pickupAt),
      start,
      end,
      status: row.status,
    })
  }
  listed.sort((a, b) => {
    const delta = a.pickupAt < b.pickupAt ? -1 : a.pickupAt > b.pickupAt ? 1 : 0
    if (delta !== 0)
      return delta
    if (a.entryId < b.entryId)
      return -1
    if (a.entryId > b.entryId)
      return 1
    return 0
  })
  return listed
}

const failedInvitationRowSchema = z.object({
  entryId: z.uuid(),
  invitationId: z.uuid(),
  status: z.string().nullable(),
  expiresAt: z.unknown(),
  role: z.string().nullable(),
})

/**
 * Failed invitations for the Home read, with Better Auth's status through
 * the Tenant's invitation view. The view has no email. The `state = 'failed'`
 * literal is what lets the partial index answer the refresh. An invitation
 * this Tenant no longer has comes back with a null status.
 */
export function failedInvitationsQuery() {
  return sql`
    select
      o.id as "entryId",
      o.invitation_id as "invitationId",
      i.status,
      i.expires_at as "expiresAt",
      i.role
    from app.mail_outbox as o
    left join app.tenant_invitation as i
      on i.id = o.invitation_id::text
    where o.kind = 'invitation'
      and o.state = 'failed'
    order by o.created_at, o.id
  `
}

/**
 * Failed invitations that are still pending, oldest first. Admin only: the
 * caller passes the session role, and any other role reads nothing. The
 * invitee's email is read from the auth role on this request and is not
 * stored. The invitation id stays inside this function: the row names the
 * outbox entry. A row whose email or role cannot be shown is left out.
 */
export async function loadFailedInvitations(
  transaction: TenantTransaction,
  context: TenantContext,
  role: TenantRole,
  now: Date,
): Promise<FailedInvitation[]> {
  if (role !== 'admin')
    return []
  const selected = z.object({ rows: z.array(failedInvitationRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(failedInvitationsQuery()),
    'Office home read failed',
  ))
  const current = selected.rows.flatMap((row) => {
    const invitedAs = tenantRoleSchema.safeParse(row.role)
    if (row.status === null || row.expiresAt == null || !invitedAs.success)
      return []
    if (!invitationIsCurrent({ status: row.status, expiresAt: toInstantDate(row.expiresAt) }, now))
      return []
    return [{ entryId: row.entryId, invitationId: row.invitationId, role: invitedAs.data }]
  })
  if (current.length === 0)
    return []
  let emails: Map<string, string>
  try {
    emails = await readInvitationEmails({ context, role }, current.map(row => row.invitationId))
  }
  catch {
    throw new Error('Office home read failed')
  }
  return current.flatMap((row) => {
    const email = z.email().safeParse(emails.get(row.invitationId))
    if (!email.success)
      return []
    return [{ kind: 'invitation' as const, entryId: row.entryId, email: email.data, role: row.role }]
  })
}

function toInstantDate(value: unknown): Date {
  return new Date(toInstant(value))
}

function officeOnly(role: string): void {
  // The resend route enforces this itself. A driver is refused before the row is read.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

function resendStore(transaction: TenantTransaction, context: TenantContext, kind: OutboxKind): FailedMailResendStore {
  return {
    load: entryId => kind === 'invitation'
      ? loadInvitationAttempt(transaction, context, entryId)
      : loadOutboxAttempt(transaction, entryId),
    settle: (entryId, state) => settleFailedOutboxEntry(transaction, kind, entryId, state),
  }
}

/**
 * One immediate resend. A work order is Admin and dispatcher. An invitation
 * is Admin only: a dispatcher is 403 here, not by hiding the row. No session
 * is 401. A missing or stale screen Tenant is 409 before the row is read.
 * A missing id, including another Tenant's, is 404. Success, stale,
 * and failure are the body. Nothing is audited. The log is the entry id, the
 * kind, and the outcome. The invitation id is never read from the request.
 */
export async function resendFailedMail(
  headers: Headers,
  entryId: unknown,
  body: unknown = {},
  mailer: Pick<Mailer, 'sendWorkOrder' | 'sendInvitation'> = mailerForApp(loadAppEnv()),
  log?: Logger,
): Promise<z.infer<typeof failedMailResendSchema>> {
  // The id is parsed before the session so a bad id does not change the
  // 401/403 order. The throw still waits until the role is allowed.
  // The claim is compared as the session opens, before that role check,
  // so a stale screen does not resend under the company the session moved to.
  const id = z.uuid().safeParse(entryId)
  const office = officeWriteClaim(headers, body ?? {})
  const emptyBody = z.strictObject({}).safeParse(office.body ?? {})
  return withTenantFromSession(headers, async ({ actor, context, transaction }) => {
    officeOnly(actor.role)
    if (!id.success || !emptyBody.success)
      throw new FailedMailInputError()
    const kind = await readOutboxKind(transaction, id.data)
    if (kind === null)
      throw new FailedMailNotFoundError()
    if (kind === 'invitation' && actor.role !== 'admin')
      throw new TenantAccessError(403, actor.userId)
    const outcome = await resendFailedOutboxEntry({
      entryId: id.data,
      store: resendStore(transaction, context, kind),
      mailer,
      // After the role check, so a missing session stays 401 when the logger is down.
      log: log ?? getLogger(),
    })
    if (outcome === 'missing')
      throw new FailedMailNotFoundError()
    return failedMailResendSchema.parse({ outcome })
  }, office)
}
