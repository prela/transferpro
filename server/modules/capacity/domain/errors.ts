/**
 * The Driver or the Vehicle is already occupied on another Ride.
 * Nothing was written. `confirm: true` on the command is the only way through.
 * Capacity owns the class; transfers decides when to throw it (ADR-0034).
 */
export class RideOverlapError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_overlap'

  constructor() {
    super('Conflict')
    this.name = 'RideOverlapError'
  }
}
