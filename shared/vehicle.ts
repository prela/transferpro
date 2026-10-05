import { z } from 'zod'
import { isCalendarDate } from './driver'

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

export const vehicleSchema = z.object({
  id: z.uuid(),
  registrationPlate: vehiclePlateSchema,
  kind: vehicleKindSchema,
  registrationExpiresOn: vehicleDateSchema,
  technicalInspectionExpiresOn: vehicleDateSchema,
  insuranceExpiresOn: vehicleDateSchema,
  description: z.string().max(VEHICLE_DESCRIPTION_MAX_LENGTH).nullable(),
  archivedAt: z.iso.datetime().nullable(),
})

export type Vehicle = z.infer<typeof vehicleSchema>

export const vehicleListSchema = z.object({
  vehicles: z.array(vehicleSchema),
})

export type VehicleList = z.infer<typeof vehicleListSchema>

/**
 * GET /api/vehicles?includeArchived=. Absent, empty, or false hides archived
 * rows. Only true includes them. Any other value is refused.
 */
export const includeArchivedQuerySchema = z.union([
  z.undefined(),
  z.null(),
  z.literal(''),
  z.literal('false'),
  z.literal(false),
  z.literal('true'),
  z.literal(true),
])

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
})

export interface CreateVehicle {
  readonly registrationPlate: string
  readonly kind: VehicleKind
  readonly registrationExpiresOn: string
  readonly technicalInspectionExpiresOn: string
  readonly insuranceExpiresOn: string
  readonly description: string | null
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
  }
}

/** Accepts a correction. Any other body throws first. */
export function parseVehiclePatch(raw: unknown): VehiclePatch {
  const parsed = vehiclePatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new VehicleInputError()
  return parsed.data
}

/** Accepts the list query. Any other value throws first. */
export function parseIncludeArchivedQuery(raw: unknown): boolean {
  const parsed = includeArchivedQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new VehicleInputError()
  return parsed.data === 'true' || parsed.data === true
}

export type VehiclePlateError = 'empty' | 'too-long'
export type VehicleKindError = 'invalid'
export type VehicleDateError = 'invalid'
export type VehicleDescriptionError = 'too-long'

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
