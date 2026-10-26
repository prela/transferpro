/**
 * Whether this Driver has a Ride that holds the session (ADR-0057).
 * Tenancy asks. It does not import transfers. The app plugin installs
 * the query. Until then the answer is no, so a Driver is not held open.
 */
export interface HoldingRideInput {
  readonly tenantId: string
  readonly userId: string
  readonly now: Date
}

export type HoldingRideQuery = (input: HoldingRideInput) => Promise<boolean>

let query: HoldingRideQuery = async () => false

export function setHoldingRideQuery(next: HoldingRideQuery): void {
  query = next
}

export function askHoldingRide(input: HoldingRideInput): Promise<boolean> {
  return query(input)
}
