import { z } from 'zod'

/**
 * A hotel or airport name fits; 200 matches a Client name and refuses a
 * pasted paragraph. Postgres `length` and this check both count characters.
 */
export const LOCATION_NAME_MAX_LENGTH = 200

/**
 * One address line. 200 covers a street and a town and refuses a pasted note.
 * The stored value is never an empty string.
 */
export const LOCATION_ADDRESS_MAX_LENGTH = 200

/** Where a Ride starts or ends. A Partner is not a Location. */
export const LOCATION_KINDS = ['airport', 'hotel', 'address', 'other'] as const

/**
 * The only strings an audit row may store for a Location change.
 * Values (the name, the kind, the address) are not in this list.
 */
export const LOCATION_FIELDS = ['name', 'kind', 'address'] as const

export const locationKindSchema = z.enum(LOCATION_KINDS)

export type LocationKind = z.infer<typeof locationKindSchema>

export const locationFieldSchema = z.enum(LOCATION_FIELDS)

export type LocationField = z.infer<typeof locationFieldSchema>

/** Trimmed, required, at most {@link LOCATION_NAME_MAX_LENGTH} characters. */
export const locationNameSchema = z.string().trim().min(1).max(LOCATION_NAME_MAX_LENGTH)

/**
 * Blank becomes null. Surrounding spaces are dropped. The stored value is
 * never an empty string.
 */
export const locationAddressSchema = z.union([
  z.null(),
  z.string().transform((value) => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }).pipe(z.string().max(LOCATION_ADDRESS_MAX_LENGTH).nullable()),
])

export const locationSchema = z.object({
  id: z.uuid(),
  name: locationNameSchema,
  kind: locationKindSchema,
  address: z.string().max(LOCATION_ADDRESS_MAX_LENGTH).nullable(),
  archivedAt: z.iso.datetime().nullable(),
})

export type Location = z.infer<typeof locationSchema>

export const locationListSchema = z.object({
  locations: z.array(locationSchema),
})

export type LocationList = z.infer<typeof locationListSchema>

/**
 * POST /api/locations. Archive is absent: a new Location starts on the list.
 * An unknown key is refused.
 */
export const createLocationSchema = z.strictObject({
  name: locationNameSchema,
  kind: locationKindSchema,
  address: locationAddressSchema.optional(),
})

export interface CreateLocation {
  readonly name: string
  readonly kind: LocationKind
  readonly address: string | null
}

/**
 * PATCH /api/locations/:id. A field that is absent stays as it is.
 * Archive is a separate route, so this body cannot set archivedAt.
 */
export const locationPatchSchema = z.strictObject({
  name: locationNameSchema.optional(),
  kind: locationKindSchema.optional(),
  address: locationAddressSchema.optional(),
})

export type LocationPatch = z.infer<typeof locationPatchSchema>

/** The body was not a valid Location. Nothing is written. The address is not in the message. */
export class LocationInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'LocationInputError'
  }
}

/** Accepts a new Location. Any other body throws first, so the caller does not open a session. */
export function parseCreateLocation(raw: unknown): CreateLocation {
  const parsed = createLocationSchema.safeParse(raw)
  if (!parsed.success)
    throw new LocationInputError()
  return {
    name: parsed.data.name,
    kind: parsed.data.kind,
    address: parsed.data.address === undefined ? null : parsed.data.address,
  }
}

/** Accepts a correction. Any other body throws first. */
export function parseLocationPatch(raw: unknown): LocationPatch {
  const parsed = locationPatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new LocationInputError()
  return parsed.data
}

export type LocationNameError = 'empty' | 'too-long'
export type LocationKindError = 'invalid'
export type LocationAddressError = 'too-long'

/** What the add and edit forms can tell the person before a request. */
export function locationNameError(name: string): LocationNameError | null {
  const trimmed = name.trim()
  if (trimmed.length === 0)
    return 'empty'
  if (trimmed.length > LOCATION_NAME_MAX_LENGTH)
    return 'too-long'
  return null
}

export function locationKindError(kind: string): LocationKindError | null {
  return locationKindSchema.safeParse(kind).success ? null : 'invalid'
}

export function locationAddressError(value: string): LocationAddressError | null {
  return value.trim().length > LOCATION_ADDRESS_MAX_LENGTH ? 'too-long' : null
}
