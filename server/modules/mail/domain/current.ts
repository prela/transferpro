import type { WorkOrderStatus } from '../../../../shared'

/**
 * Facts the current-ness rule needs. No names and no addresses.
 * `rideFinished` is `done`, `no-show`, or `cancelled`.
 * `now` and `pickupAt` are instants. The Tenant time zone is display only.
 */
export interface WorkOrderCurrentFacts {
  readonly status: WorkOrderStatus
  /** The Driver this mail is about. */
  readonly driverId: string
  /** The Driver on the Ride now. Null when the Ride has none. */
  readonly rideDriverId: string | null
  readonly rideFinished: boolean
  readonly pickupAt: Date
  readonly now: Date
}

/**
 * Whether this attempt should still be sent (ADR-0045).
 * Assigned and changed stay current while that Driver still has the Ride,
 * the Ride is not finished, and the pickup has not passed.
 * No longer yours stays current while that Driver does not have the Ride
 * again and the pickup has not passed. A finished Ride does not drop it:
 * the Driver check is the one the rule names.
 * Cancelled stays current while the pickup has not passed.
 * Another mail for the same Ride is not an input. Both can be current.
 */
export function workOrderIsCurrent(facts: WorkOrderCurrentFacts): boolean {
  const pickupStillAhead = facts.now.getTime() < facts.pickupAt.getTime()
  if (!pickupStillAhead)
    return false
  if (facts.status === 'cancelled')
    return true
  if (facts.status === 'no_longer_yours')
    return facts.rideDriverId !== facts.driverId
  return !facts.rideFinished && facts.rideDriverId === facts.driverId
}
