import type { SQL } from 'drizzle-orm'
import type { HandedOffRideResult, HandOffRideInput } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canChangeHandedOffPartner, canHandOffRide, canTakeBackHandedOffRide, handedOffRideSchema, parseChangeRidePartner, parseHandOffRide, parseTakeBackRide, RIDE_HANDOFF_CLEAR_FIELDS, RIDE_HANDOFF_OPEN_FIELDS, RIDE_PARTNER_CHANGED_FIELDS, RIDE_TAKEN_BACK_FIELDS, rideStateSchema } from '../../../../shared'
import { hideDatabaseError, loadAppEnv } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { lockTenantCapacity } from '../../capacity'
import { partnerPresenceForHandoff } from '../../partners'
import { mailerForApp, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { RideNotFoundError } from './assign'
import { checkPartnerCapacity } from './capacity-check'
import { mailOutboxQueue } from './mail-outbox-worker'
import { claimTransferVersion, refuseStaleVersion } from './transfer-version'
import { deliverStagedWorkOrder, readAssignedWorkOrder, stageWorkOrder } from './work-order'

/**
 * The Ride is not `unassigned`, `assigned`, or `accepted`, including when
 * a concurrent command already moved it. Nothing was written.
 */
export class RideNotHandoffableError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_handoffable'

  constructor() {
    super('Conflict')
    this.name = 'RideNotHandoffableError'
  }
}

/**
 * A Partner change or a take-back found a Ride that is not `handed_off`,
 * including when a concurrent command already moved it. Nothing was written.
 */
export class RideNotHandedOffError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_handed_off'

  constructor() {
    super('Conflict')
    this.name = 'RideNotHandedOffError'
  }
}

/**
 * The Partner is archived. ADR-0049 refuses a new handoff and a change
 * onto an archived Partner. The Ride already handed to one is left as it
 * is. Nothing was written, and no work order was staged.
 */
export class RidePartnerArchivedError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_partner_archived'

  constructor() {
    super('Conflict')
    this.name = 'RidePartnerArchivedError'
  }
}

/**
 * The Ride is already with this active Partner. A no-op would still bump
 * the version and append an audit row, so it is refused. An archived
 * Partner with the same id is `ride_partner_archived` instead, because
 * that check runs first.
 */
export class RidePartnerUnchangedError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_partner_unchanged'

  constructor() {
    super('Conflict')
    this.name = 'RidePartnerUnchangedError'
  }
}

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: rideStateSchema,
    version: z.number().int(),
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
    partnerId: z.uuid().nullable(),
  })),
})

type LockedRide = z.infer<typeof lockedRows>['rows'][number]

const storedRows = z.object({
  rows: z.array(handedOffRideSchema),
})

interface Delivery {
  readonly mailer?: Mailer
  readonly logger?: Logger
}

/**
 * Hand the Ride to a Partner. The body is parsed first. A driver is 403.
 * From `assigned` or `accepted`, the Driver and the Vehicle are cleared and
 * that Driver is mailed no longer yours, the same way a clear does. From
 * `unassigned` nobody is mailed. A Partner is never mailed. The outbox
 * entry commits with the handoff. A rejection leaves the handoff in place
 * and the entry pending.
 */
export async function handOffRide(
  headers: Headers,
  rawRideId: unknown,
  rawBody: unknown,
  delivery?: Delivery,
): Promise<HandedOffRideResult> {
  const input = parseHandOffRide(rawRideId, rawBody)
  const queue = await mailOutboxQueue()
  const saved = await withTenantFromSession(headers, async ({ actor, context, transaction }) => {
    officeOnly(actor.role)
    const handed = await handOffRideForOffice(transaction, actor.userId, input)
    if (handed.released === null)
      return { ride: handed.ride, staged: null }
    const order = await readAssignedWorkOrder(transaction, handed.ride.id, handed.released)
    const staged = await stageWorkOrder(transaction, order, 'no_longer_yours', { queue, context })
    return { ride: handed.ride, staged }
  })
  if (saved.staged === null)
    return { ride: saved.ride, workOrders: [] }
  const notice = await deliverStagedWorkOrder(headers, saved.staged, mailerFrom(delivery), delivery?.logger)
  return { ride: saved.ride, workOrders: [notice] }
}

/**
 * Give a handed-off Ride to another active Partner. The body is parsed
 * first. A driver is 403. The version bumps. No mail is sent. An unavailable
 * Partner is 409 `ride_unavailable` unless `confirm` is set (ADR-0034).
 */
export async function changeRidePartner(
  headers: Headers,
  rawRideId: unknown,
  rawBody: unknown,
): Promise<HandedOffRideResult> {
  const input = parseChangeRidePartner(rawRideId, rawBody)
  const saved = await withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return changeRidePartnerForOffice(transaction, actor.userId, input)
  })
  return { ride: saved, workOrders: [] }
}

/**
 * Return a handed-off Ride to `unassigned`. The body is parsed first. A
 * driver is 403. The Partner is cleared, including one that was archived
 * after the handoff. No capacity lock, no mail, and the version bumps.
 */
export async function takeBackRide(
  headers: Headers,
  rawRideId: unknown,
  rawBody: unknown,
): Promise<HandedOffRideResult> {
  const input = parseTakeBackRide(rawRideId, rawBody)
  const saved = await withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return takeBackRideForOffice(transaction, actor.userId, input.rideId, input.version)
  })
  return { ride: saved, workOrders: [] }
}

/**
 * The office handoff. Lock order is the ADR-0034 order: the Transfer and
 * Ride, then the refusals that need no other row, then the Tenant capacity
 * lock, then the Partner. An archived Partner is refused before the window
 * is read. An unavailable Partner is 409 `ride_unavailable` and writes
 * nothing; `confirm: true` passes it. The version is claimed only after
 * that, so a refusal does not bump it.
 */
export async function handOffRideForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  input: HandOffRideInput,
): Promise<{ ride: z.infer<typeof handedOffRideSchema>, released: { driverId: string, vehicleId: string } | null }> {
  const current = await lockRide(transaction, input.rideId, 'Ride handoff failed')
  if (!current)
    throw new RideNotFoundError()
  refuseStaleVersion(current.version, input.version)
  if (!canHandOffRide(current.state))
    throw new RideNotHandoffableError()
  // The pair checks keep a Driver and a Vehicle together. One without the other cannot be audited.
  if ((current.driverId === null) !== (current.vehicleId === null))
    throw new RideNotHandoffableError()

  await lockTenantCapacity(transaction)
  const presence = await partnerPresenceForHandoff(transaction, input.partnerId)
  if (presence === 'missing')
    throw new RideNotFoundError()
  if (presence === 'archived')
    throw new RidePartnerArchivedError()
  await checkPartnerCapacity(transaction, {
    rideId: input.rideId,
    partnerId: input.partnerId,
    confirm: input.confirm === true,
  })

  const released = current.driverId !== null && current.vehicleId !== null
    ? { driverId: current.driverId, vehicleId: current.vehicleId }
    : null
  await claimTransferVersion(transaction, current.transferId, input.version, actorUserId, 'Ride handoff failed')
  const updated = storedRows.parse(await runStep(transaction, sql`
    update app.rides
    set state = 'handed_off',
        partner_id = ${input.partnerId},
        driver_id = null,
        vehicle_id = null,
        must_accept = null
    where id = ${input.rideId}
      and state in ('unassigned', 'assigned', 'accepted')
      and driver_id is not distinct from ${current.driverId}
      and vehicle_id is not distinct from ${current.vehicleId}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept",
      partner_id as "partnerId"
  `, 'Ride handoff failed')).rows[0]
  if (!updated)
    throw new RideNotHandoffableError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.handed_off',
    actorUserId,
    subjectUserId: null,
    data: released === null
      ? {
          rideId: updated.id,
          partnerId: input.partnerId,
          fields: [RIDE_HANDOFF_OPEN_FIELDS[0], RIDE_HANDOFF_OPEN_FIELDS[1]],
        }
      : {
          rideId: updated.id,
          partnerId: input.partnerId,
          driverId: released.driverId,
          vehicleId: released.vehicleId,
          fields: [
            RIDE_HANDOFF_CLEAR_FIELDS[0],
            RIDE_HANDOFF_CLEAR_FIELDS[1],
            RIDE_HANDOFF_CLEAR_FIELDS[2],
            RIDE_HANDOFF_CLEAR_FIELDS[3],
            RIDE_HANDOFF_CLEAR_FIELDS[4],
          ],
        },
  }), 'Ride handoff failed')
  return { ride: updated, released }
}

export async function changeRidePartnerForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  input: HandOffRideInput,
): Promise<z.infer<typeof handedOffRideSchema>> {
  const current = await lockRide(transaction, input.rideId, 'Ride partner change failed')
  if (!current)
    throw new RideNotFoundError()
  refuseStaleVersion(current.version, input.version)
  const partnerId = current.partnerId
  if (!canChangeHandedOffPartner(current.state) || partnerId === null)
    throw new RideNotHandedOffError()

  await lockTenantCapacity(transaction)
  const presence = await partnerPresenceForHandoff(transaction, input.partnerId)
  if (presence === 'missing')
    throw new RideNotFoundError()
  // Archived wins over "already this Partner", so a same archived id is not a no-op.
  if (presence === 'archived')
    throw new RidePartnerArchivedError()
  if (input.partnerId === partnerId)
    throw new RidePartnerUnchangedError()
  await checkPartnerCapacity(transaction, {
    rideId: input.rideId,
    partnerId: input.partnerId,
    confirm: input.confirm === true,
  })

  await claimTransferVersion(transaction, current.transferId, input.version, actorUserId, 'Ride partner change failed')
  const updated = storedRows.parse(await runStep(transaction, sql`
    update app.rides
    set partner_id = ${input.partnerId}
    where id = ${input.rideId}
      and state = 'handed_off'
      and partner_id = ${partnerId}
      and partner_id is distinct from ${input.partnerId}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept",
      partner_id as "partnerId"
  `, 'Ride partner change failed')).rows[0]
  if (!updated)
    throw new RideNotHandedOffError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.partner_changed',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      partnerId: input.partnerId,
      fields: [RIDE_PARTNER_CHANGED_FIELDS[0]],
    },
  }), 'Ride partner change failed')
  return updated
}

export async function takeBackRideForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  version: number,
): Promise<z.infer<typeof handedOffRideSchema>> {
  const current = await lockRide(transaction, rideId, 'Ride take-back failed')
  if (!current)
    throw new RideNotFoundError()
  refuseStaleVersion(current.version, version)
  const partnerId = current.partnerId
  if (!canTakeBackHandedOffRide(current.state) || partnerId === null)
    throw new RideNotHandedOffError()

  // Take-back frees the Partner. It takes no capacity lock and does not read the Partner,
  // so an archived Partner can still be taken back (ADR-0048, ADR-0049).
  await claimTransferVersion(transaction, current.transferId, version, actorUserId, 'Ride take-back failed')
  const updated = storedRows.parse(await runStep(transaction, sql`
    update app.rides
    set state = 'unassigned',
        partner_id = null,
        driver_id = null,
        vehicle_id = null,
        must_accept = null
    where id = ${rideId}
      and state = 'handed_off'
      and partner_id = ${partnerId}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept",
      partner_id as "partnerId"
  `, 'Ride take-back failed')).rows[0]
  if (!updated)
    throw new RideNotHandedOffError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.taken_back',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      partnerId,
      fields: [RIDE_TAKEN_BACK_FIELDS[0], RIDE_TAKEN_BACK_FIELDS[1]],
    },
  }), 'Ride take-back failed')
  return updated
}

function officeOnly(role: string): void {
  // Handoff is office work. A driver does none of it (ADR-0048).
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * The Transfer is the outer table, the same order as a correction and an
 * assignment, so those commands cannot deadlock with a handoff. `partner_id`
 * is selected here and not on the shared assignment lock: that lock's row
 * shape is what the assignment tests fake.
 */
async function lockRide(transaction: TenantTransaction, rideId: string, failure: string): Promise<LockedRide | undefined> {
  return lockedRows.parse(await runStep(transaction, sql`
    select r.id,
           r.transfer_id as "transferId",
           r.state,
           t.version,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.must_accept as "mustAccept",
           r.partner_id as "partnerId"
    from app.transfers as t
    join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
    where r.id = ${rideId}
    for update of t, r
  `, failure)).rows[0]
}

function mailerFrom(delivery?: Delivery): Mailer {
  return delivery?.mailer ?? mailerForApp(loadAppEnv())
}

function runStep(transaction: TenantTransaction, query: SQL, failure: string): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), failure)
}
