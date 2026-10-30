import { z } from 'zod'
import { isCalendarDate } from './date'

/**
 * A registration plate after spaces are removed. 16 covers a Croatian plate
 * with room to spare and refuses a pasted sentence.
 */
export const VEHICLE_PLATE_MAX_LENGTH = 16

/**
 * Free-text description. 120 is a short note (make, seats, colour) and
 * refuses a pasted paragraph.
 */
export const VEHICLE_DESCRIPTION_MAX_LENGTH = 120

/**
 * Passenger seats, not counting the Driver. 1 is the smallest vehicle the
 * office can record. 999 refuses a pasted phone number and still covers a coach.
 */
export const SEAT_COUNT_MIN = 1
export const SEAT_COUNT_MAX = 999

/** Own fleet, or a vehicle the office uses only some of the time. */
export const VEHICLE_KINDS = ['fixed', 'occasional'] as const

/**
 * The only strings an audit row may store for a Vehicle change.
 * Values (the plate, the dates, the kind, the description) are not in this list.
 */
export const VEHICLE_FIELDS = [
  'registrationPlate',
  'kind',
  'registrationExpiresOn',
  'technicalInspectionExpiresOn',
  'insuranceExpiresOn',
  'description',
  'seatCount',
] as const

export const vehicleKindSchema = z.enum(VEHICLE_KINDS)

export type VehicleKind = z.infer<typeof vehicleKindSchema>

export const vehicleFieldSchema = z.enum(VEHICLE_FIELDS)

export type VehicleField = z.infer<typeof vehicleFieldSchema>

/**
 * Case-fold and drop spaces so DU 123 AB and du123ab are the same plate.
 * Hyphens stay: only case and spaces are normalized.
 */
export function normalizeRegistrationPlate(value: string): string {
  return value.replaceAll(/\s+/g, '').toUpperCase()
}

export const vehiclePlateSchema = z.string().transform(normalizeRegistrationPlate).pipe(
  z.string().min(1).max(VEHICLE_PLATE_MAX_LENGTH),
)

export const vehicleDateSchema = z.string().refine(isCalendarDate)

/**
 * Blank becomes null. Surrounding spaces are dropped. The stored value is
 * never an empty string.
 */
export const vehicleDescriptionSchema = z.union([
  z.null(),
  z.string().transform((value) => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }).pipe(z.string().max(VEHICLE_DESCRIPTION_MAX_LENGTH).nullable()),
])

/** A stored count. Null is an existing Vehicle the office has not filled in yet. */
export const seatCountSchema = z.number().int().min(SEAT_COUNT_MIN).max(SEAT_COUNT_MAX)

export const vehicleSchema = z.object({
  id: z.uuid(),
  registrationPlate: vehiclePlateSchema,
  kind: vehicleKindSchema,
  registrationExpiresOn: vehicleDateSchema,
  technicalInspectionExpiresOn: vehicleDateSchema,
  insuranceExpiresOn: vehicleDateSchema,
  description: z.string().max(VEHICLE_DESCRIPTION_MAX_LENGTH).nullable(),
  seatCount: seatCountSchema.nullable(),
  archivedAt: z.iso.datetime().nullable(),
})

export type Vehicle = z.infer<typeof vehicleSchema>

export const vehicleListSchema = z.object({
  vehicles: z.array(vehicleSchema),
})

export type VehicleList = z.infer<typeof vehicleListSchema>

/**
 * POST /api/vehicles. Archive is absent: a new Vehicle starts on the list.
 * An unknown key is refused.
 */
export const createVehicleSchema = z.strictObject({
  registrationPlate: vehiclePlateSchema,
  kind: vehicleKindSchema,
  registrationExpiresOn: vehicleDateSchema,
  technicalInspectionExpiresOn: vehicleDateSchema,
  insuranceExpiresOn: vehicleDateSchema,
  description: vehicleDescriptionSchema.optional(),
  seatCount: seatCountSchema,
})

export interface CreateVehicle {
  readonly registrationPlate: string
  readonly kind: VehicleKind
  readonly registrationExpiresOn: string
  readonly technicalInspectionExpiresOn: string
  readonly insuranceExpiresOn: string
  readonly description: string | null
  readonly seatCount: number
}

/**
 * PATCH /api/vehicles/:id. A field that is absent stays as it is.
 * Archive is a separate route, so this body cannot set archivedAt.
 */
export const vehiclePatchSchema = z.strictObject({
  registrationPlate: vehiclePlateSchema.optional(),
  kind: vehicleKindSchema.optional(),
  registrationExpiresOn: vehicleDateSchema.optional(),
  technicalInspectionExpiresOn: vehicleDateSchema.optional(),
  insuranceExpiresOn: vehicleDateSchema.optional(),
  description: vehicleDescriptionSchema.optional(),
  // Absent keeps the stored count, including an empty one. Null, 0, and a
  // blank are not a count, so a save that sends them is refused.
  seatCount: seatCountSchema.optional(),
})

export type VehiclePatch = z.infer<typeof vehiclePatchSchema>

/** The body was not a valid Vehicle. Nothing is written. The plate is not in the message. */
export class VehicleInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'VehicleInputError'
  }
}

/** Accepts a new Vehicle. Any other body throws first, so the caller does not open a session. */
export function parseCreateVehicle(raw: unknown): CreateVehicle {
  const parsed = createVehicleSchema.safeParse(raw)
  if (!parsed.success)
    throw new VehicleInputError()
  return {
    registrationPlate: parsed.data.registrationPlate,
    kind: parsed.data.kind,
    registrationExpiresOn: parsed.data.registrationExpiresOn,
    technicalInspectionExpiresOn: parsed.data.technicalInspectionExpiresOn,
    insuranceExpiresOn: parsed.data.insuranceExpiresOn,
    description: parsed.data.description === undefined ? null : parsed.data.description,
    seatCount: parsed.data.seatCount,
  }
}

/** Accepts a correction. Any other body throws first. */
export function parseVehiclePatch(raw: unknown): VehiclePatch {
  const parsed = vehiclePatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new VehicleInputError()
  return parsed.data
}

export type VehiclePlateError = 'empty' | 'too-long'
export type VehicleKindError = 'invalid'
export type VehicleDateError = 'invalid'
export type VehicleDescriptionError = 'too-long'
export type SeatCountError = 'empty' | 'invalid' | 'too-small' | 'too-large'

/** What the add and edit forms can tell the person before a request. */
export function vehiclePlateError(plate: string): VehiclePlateError | null {
  const normalized = normalizeRegistrationPlate(plate)
  if (normalized.length === 0)
    return 'empty'
  if (normalized.length > VEHICLE_PLATE_MAX_LENGTH)
    return 'too-long'
  return null
}

export function vehicleKindError(kind: string): VehicleKindError | null {
  return vehicleKindSchema.safeParse(kind).success ? null : 'invalid'
}

export function vehicleDateError(value: string): VehicleDateError | null {
  return isCalendarDate(value) ? null : 'invalid'
}

export function vehicleDescriptionError(value: string): VehicleDescriptionError | null {
  return value.trim().length > VEHICLE_DESCRIPTION_MAX_LENGTH ? 'too-long' : null
}

/** What the add and edit forms can tell the person before a request. */
export function vehicleSeatCountError(value: string): SeatCountError | null {
  const trimmed = value.trim()
  if (trimmed.length === 0)
    return 'empty'
  if (!/^\d+$/.test(trimmed))
    return 'invalid'
  const count = Number(trimmed)
  if (count < SEAT_COUNT_MIN)
    return 'too-small'
  if (count > SEAT_COUNT_MAX)
    return 'too-large'
  return null
}

/**
 * True when this Ride's passengers do not fit the Vehicle.
 * An empty count is an existing Vehicle the office has not filled in, and
 * that shows no warning (ADR-0059). Equal counts fit. The assignment still saves.
 */
export function passengersExceedSeatCount(passengerCount: number, seatCount: number | null | undefined): boolean {
  if (seatCount == null)
    return false
  return passengerCount > seatCount
}

/** The assigned Vehicle's seat count. No Vehicle, or a missing id, is an empty count. */
export function recordedSeatCount(
  vehicles: readonly { readonly id: string, readonly seatCount: number | null }[],
  vehicleId: string | null,
): number | null {
  if (vehicleId === null)
    return null
  return vehicles.find(vehicle => vehicle.id === vehicleId)?.seatCount ?? null
}
