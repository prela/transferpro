import type { WorkOrderStatus } from '../../../../shared'

/**
 * Facts the current-ness rule needs. No names and no addresses.
 * `rideFinished` is `done` or `no-show`. `rideCancelled` is the Ride state
 * `cancelled`. Pickup time is not a fact: Damir, 18.10., dropped it.
 * `superseded` means a newer work order for the same Ride was recorded
 * after this entry. Rows from the same transaction share `created_at`
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
 * Stale only when the Ride is finished or cancelled, or a newer work
 * order for that Ride replaced this one. A driver change by itself does
 * not. The cancellation notice is why the Ride is cancelled, so that
 * state does not make the notice stale. A newer entry still does.
 */
export function workOrderIsCurrent(facts: WorkOrderCurrentFacts): boolean {
  if (facts.superseded)
    return false
  if (facts.status === 'cancelled')
    return true
  return !facts.rideFinished && !facts.rideCancelled
}
