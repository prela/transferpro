/**
 * Transfer command failures. The message is a fixed phrase for the status.
 * A guest name, a count, and a price are not on the error. Shared so the
 * create and the correction can throw the same errors without importing
 * each other (ADR-0018).
 */

/** The Transfer is not in this Tenant. Another Tenant's row looks the same. */
export class TransferNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'TransferNotFoundError'
  }
}

/**
 * The Ride is finished. The booking stays as it was. Nothing is written.
 * Creating an extra vehicle uses the same code when the main Transfer's
 * Ride is finished or cancelled (ADR-0054).
 */
export class TransferNotCorrectableError extends Error {
  readonly statusCode = 409
  readonly code = 'transfer_closed'

  constructor() {
    super('Conflict')
    this.name = 'TransferNotCorrectableError'
  }
}

/**
 * The named main Transfer is itself an extra vehicle. A group is one level
 * deep. Nothing is written (ADR-0054).
 */
export class TransferNotMainError extends Error {
  readonly statusCode = 409
  readonly code = 'transfer_not_main'

  constructor() {
    super('Conflict')
    this.name = 'TransferNotMainError'
  }
}

/**
 * An extra vehicle's Price stays 0. A correction that sends another price
 * writes nothing (ADR-0054).
 */
export class ExtraVehiclePriceError extends Error {
  readonly statusCode = 409
  readonly code = 'extra_vehicle_price'

  constructor() {
    super('Conflict')
    this.name = 'ExtraVehiclePriceError'
  }
}

/**
 * The group's ordered passenger count lives on the main Transfer. A
 * correction that sends one for an extra vehicle writes nothing (ADR-0054).
 */
export class ExtraVehicleCountError extends Error {
  readonly statusCode = 409
  readonly code = 'extra_vehicle_count'

  constructor() {
    super('Conflict')
    this.name = 'ExtraVehicleCountError'
  }
}
