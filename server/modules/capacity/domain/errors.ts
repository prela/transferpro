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

/**
 * The Driver or the Vehicle has an unavailability window over the Ride's
 * occupied window. Nothing was written. One `confirm: true` passes this and
 * an overlap together (ADR-0034); capacity owns the class, transfers throws it.
 */
export class RideUnavailableError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_unavailable'

  constructor() {
    super('Conflict')
    this.name = 'RideUnavailableError'
  }
}

/**
 * The window has no free Driver with a free Vehicle and no free Partner.
 * Nothing was written. `confirm: true` does not pass it (ADR-0034).
 * Capacity owns the class; transfers decides when to throw it.
 * A Transfer correction never throws this: it saves and warns.
 */
export class FullyBookedError extends Error {
  readonly statusCode = 409
  readonly code = 'fully_booked'

  constructor() {
    super('Conflict')
    this.name = 'FullyBookedError'
  }
}

/** The window, the Driver, or the Vehicle is not in this Tenant, or the window was removed. */
export class UnavailabilityNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not found')
    this.name = 'UnavailabilityNotFoundError'
  }
}

/** An archived Driver or Vehicle takes no new or moved window. Removing one stays open. */
export class UnavailabilityArchivedError extends Error {
  readonly statusCode = 409
  readonly code = 'unavailability_archived'

  constructor() {
    super('Conflict')
    this.name = 'UnavailabilityArchivedError'
  }
}
