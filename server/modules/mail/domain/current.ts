import type { WorkOrderStatus } from '../../../../shared'

/**
 * Facts the current-ness rule needs. No names and no addresses.
 * `rideFinished` is `done` or `no-show`. `rideCancelled` is the Ride state
 * `cancelled`. Pickup time is not a fact: Damir, 18.10., dropped it.
 * `superseded` means a newer work order for the same Ride and the same
 * Driver was recorded after this entry. A later mail to another Driver
 * does not count. Rows from the same transaction share `created_at`
 * and do not supersede each other.
 */
export interface WorkOrderCurrentFacts {
  readonly status: WorkOrderStatus
  readonly rideFinished: boolean
  readonly rideCancelled: boolean
  readonly superseded: boolean
}

/**
 * Whether this attempt should still be sent (ADR-0045, Damir 18.10.).
 * Stale when the Ride is finished (`done` or `no-show`), or when a newer
 * work order for the same Ride and the same Driver replaced this one.
 * A cancelled Ride also stales assigned and changed mail. It does not
 * stale "no longer yours" or the cancellation notice. A mail to another
 * Driver does not replace this one.
 */
export function workOrderIsCurrent(facts: WorkOrderCurrentFacts): boolean {
  if (facts.superseded || facts.rideFinished)
    return false
  // Damir 18.10.: the Driver who lost the Ride is still told, even after a cancel.
  if (facts.status === 'cancelled' || facts.status === 'no_longer_yours')
    return true
  return !facts.rideCancelled
}
