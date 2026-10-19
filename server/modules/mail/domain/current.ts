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

/**
 * What an invitation's current-ness needs: Better Auth's status and the expiry.
 * No email and no id. Null is an invitation this Tenant cannot find.
 */
export interface InvitationCurrentFacts {
  readonly status: string
  readonly expiresAt: Date
}

/**
 * Whether an invitation mail should still be sent (ADR-0045).
 * Current while it is pending. Accepted, revoked (`canceled`), rejected,
 * expired, or missing makes it stale. The expiry is exclusive, as accept is.
 */
export function invitationIsCurrent(facts: InvitationCurrentFacts | null, now: Date): boolean {
  return facts !== null
    && facts.status === 'pending'
    && facts.expiresAt.getTime() > now.getTime()
}

const FINISHED_RIDE_STATES = new Set(['done', 'no-show'])

/**
 * A failed work order still belongs on Home when a send would still go out.
 * Pickup time is not a fact. "No longer yours" stays when the Ride is cancelled
 * and leaves when that Ride is finished or this Driver has a newer work order.
 */
export function failedWorkOrderMatters(row: {
  readonly status: WorkOrderCurrentFacts['status']
  readonly rideState: string
  readonly superseded: boolean
}): boolean {
  return workOrderIsCurrent({
    status: row.status,
    rideFinished: FINISHED_RIDE_STATES.has(row.rideState),
    rideCancelled: row.rideState === 'cancelled',
    superseded: row.superseded,
  })
}
