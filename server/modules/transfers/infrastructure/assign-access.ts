import type { AssignedRide, RosterVehicleSuggestion } from '../../../../shared'
import type { Logger } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { parseAssignRide, parseRosterVehicleRead } from '../../../../shared'
import { loadAppEnv } from '../../../core/index'
import { mailerForApp, TenantAccessError, withOfficeWrite, withTenantFromSession } from '../../tenancy'
import { assignUnassignedRide, suggestRosterVehicle } from './assign'
import { mailOutboxQueue } from './mail-outbox-worker'
import { deliverStagedWorkOrder, readAssignedWorkOrder, stageWorkOrder } from './work-order'

function officeOnly(role: string): void {
  // Assigning a Ride is office work. A driver does none of it (ADR-0005).
  // The check runs before a Ride, a Driver, or a Vehicle is loaded.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * Assign a Driver and a Vehicle together. The body is parsed first, so a
 * Driver without a Vehicle never opens a session. A driver is 403. The
 * update and `ride.assigned` commit together, and so does the outbox entry.
 * The first attempt waits after that commit. A rejection leaves the Ride
 * assigned and the entry pending. Tests pass a mailer. The address is not
 * on the result.
 */
export async function assignRide(
  headers: Headers,
  raw: unknown,
  delivery?: { mailer: Mailer, logger?: Logger },
): Promise<AssignedRide> {
  const queue = await mailOutboxQueue()
  const saved = await withOfficeWrite(headers, raw, parseAssignRide, async ({ actor, context, transaction }, input) => {
    officeOnly(actor.role)
    const assigned = await assignUnassignedRide(transaction, actor.userId, input)
    const order = await readAssignedWorkOrder(transaction, assigned.ride.id)
    const staged = await stageWorkOrder(transaction, order, 'assigned', { queue, context })
    return { ride: assigned.ride, staged, relocationWarnings: assigned.relocationWarnings }
  })
  const mailer = delivery?.mailer ?? mailerForApp(loadAppEnv())
  const notice = await deliverStagedWorkOrder(headers, saved.staged, mailer, delivery?.logger)
  return { ride: saved.ride, workOrders: [notice], relocationWarnings: saved.relocationWarnings }
}

/**
 * The roster Vehicle for this Ride and Driver. The ids are parsed first.
 * A driver is 403. The read writes nothing, including when the suggestion is none.
 */
export async function rosterVehicleForRide(headers: Headers, rawRideId: unknown, rawDriverId: unknown): Promise<RosterVehicleSuggestion> {
  const input = parseRosterVehicleRead(rawRideId, rawDriverId)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return suggestRosterVehicle(transaction, input.rideId, input.driverId)
  })
}
