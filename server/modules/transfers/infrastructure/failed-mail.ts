import type { OfficeHome } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { FailedMailResendStore } from '../../mail'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { failedMailResendSchema, WORK_ORDER_STATUSES } from '../../../../shared'
import { getLogger, hideDatabaseError, loadAppEnv } from '../../../core/index'
import { failedWorkOrderMatters, resendFailedWorkOrder } from '../../mail'
import { mailerForApp, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { toInstant } from './transfers'
import { loadOutboxAttempt, settleFailedWorkOrder } from './work-order-attempt'

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
 * work order only: invitations join in a later ticket. The address is not
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
): Promise<OfficeHome['failedMails']> {
  const selected = z.object({ rows: z.array(failedRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(failedWorkOrdersQuery()),
    'Office home read failed',
  ))
  const listed: OfficeHome['failedMails'][number][] = []
  for (const row of selected.rows) {
    if (!failedWorkOrderMatters(row))
      continue
    const start = places.get(row.startLocationId)
    const end = places.get(row.endLocationId)
    const driverName = drivers.get(row.driverId)
    if (start === undefined || end === undefined || driverName === undefined)
      throw new Error('Office home read failed')
    listed.push({
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

function officeOnly(role: string): void {
  // The resend route enforces this itself. A driver is refused before the row is read.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

function resendStore(transaction: TenantTransaction): FailedMailResendStore {
  return {
    load: entryId => loadOutboxAttempt(transaction, entryId),
    settle: (entryId, state) => settleFailedWorkOrder(transaction, entryId, state),
  }
}

/**
 * One immediate resend. Admin and dispatcher only. No session is 401.
 * A missing id, including another Tenant's, is 404. Success, stale, and
 * failure are the body. Nothing is audited. The log is the entry id, the
 * kind, and the outcome.
 */
export async function resendFailedMail(
  headers: Headers,
  entryId: unknown,
  body: unknown = {},
  mailer: Pick<Mailer, 'sendWorkOrder'> = mailerForApp(loadAppEnv()),
  log?: Logger,
): Promise<z.infer<typeof failedMailResendSchema>> {
  // Parsed before the session so a bad id does not change the 401/403 order.
  // The throw waits until the role is allowed.
  const id = z.uuid().safeParse(entryId)
  const emptyBody = z.strictObject({}).safeParse(body ?? {})
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    if (!id.success || !emptyBody.success)
      throw new FailedMailInputError()
    const outcome = await resendFailedWorkOrder({
      entryId: id.data,
      store: resendStore(transaction),
      mailer,
      // After the role check, so a missing session stays 401 when the logger is down.
      log: log ?? getLogger(),
    })
    if (outcome === 'missing')
      throw new FailedMailNotFoundError()
    return failedMailResendSchema.parse({ outcome })
  })
}
