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

/**
 * Suggestions start after three characters. One or two letters are noise,
 * and they would spend the provider quota for nothing.
 */
export const LOCATION_SUGGEST_MIN_LENGTH = 3

/**
 * An opaque place id. Today's ids are short. 1024 refuses a longer one
 * instead of storing an unbounded string (ADR-0031).
 */
export const PLACE_REF_MAX_LENGTH = 1024

/** Known place providers. `google` is the only one in v1 (ADR-0031). */
export const PLACE_PROVIDERS = ['google'] as const

/** Where a Ride starts or ends. A Partner is not a Location. */
export const LOCATION_KINDS = ['airport', 'hotel', 'address', 'other'] as const

/**
 * The only strings an audit row may store for a Location change.
 * Values (the name, the kind, the address, the place reference) are not in this list.
 * `placeRef` names a change of provider or reference. The audit row stores neither.
 */
export const LOCATION_FIELDS = ['name', 'kind', 'address', 'iata', 'placeRef'] as const

export const locationKindSchema = z.enum(LOCATION_KINDS)

export type LocationKind = z.infer<typeof locationKindSchema>

export const locationFieldSchema = z.enum(LOCATION_FIELDS)

export type LocationField = z.infer<typeof locationFieldSchema>

export const placeProviderSchema = z.enum(PLACE_PROVIDERS)

export type PlaceProvider = z.infer<typeof placeProviderSchema>

/**
 * A picked suggestion. Both halves are set, or the Location has no place.
 * The reference is opaque. The domain does not interpret it.
 */
export const locationPlaceSchema = z.strictObject({
  provider: placeProviderSchema,
  placeRef: z.string().trim().min(1).max(PLACE_REF_MAX_LENGTH),
})

export type LocationPlace = z.infer<typeof locationPlaceSchema>

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

/**
 * Three ASCII letters, or empty. Blank and null are the same: no code.
 * The stored value is uppercase, so `dbv` and `DBV` are one code.
 */
export const locationIataSchema = z.union([
  z.null(),
  z.string().transform((value) => {
    const trimmed = value.trim()
    if (trimmed === '')
      return null
    // Uppercase only after the letters are already three ASCII letters.
    // `ßa`.toUpperCase() is `SSA`, which would otherwise pass a later check.
    if (!/^[a-z]{3}$/i.test(trimmed))
      return trimmed
    return trimmed.toUpperCase()
  }).pipe(z.string().regex(/^[A-Z]{3}$/).nullable()),
])

export const locationSchema = z.object({
  id: z.uuid(),
  name: locationNameSchema,
  kind: locationKindSchema,
  address: z.string().max(LOCATION_ADDRESS_MAX_LENGTH).nullable(),
  iata: z.string().regex(/^[A-Z]{3}$/).nullable(),
  place: locationPlaceSchema.nullable(),
  archivedAt: z.iso.datetime().nullable(),
})

export type Location = z.infer<typeof locationSchema>

export const locationListSchema = z.object({
  locations: z.array(locationSchema),
})

export type LocationList = z.infer<typeof locationListSchema>

/**
 * The Location an Admin or a Dispatcher reads. `embedUrl` is built for
 * this response and is not stored. Null means there is no map. A Driver's
 * payload does not use this schema (ADR-0052).
 */
export const officeLocationSchema = locationSchema.extend({
  embedUrl: z.string().min(1).nullable(),
})

export type OfficeLocation = z.infer<typeof officeLocationSchema>

export const officeLocationListSchema = z.object({
  locations: z.array(officeLocationSchema),
})

export type OfficeLocationList = z.infer<typeof officeLocationListSchema>

/**
 * POST /api/locations. Archive is absent: a new Location starts on the list.
 * An unknown key is refused.
 */
export const createLocationSchema = z.strictObject({
  name: locationNameSchema,
  kind: locationKindSchema,
  address: locationAddressSchema.optional(),
  iata: locationIataSchema.optional(),
  place: locationPlaceSchema.nullable().optional(),
})

export interface CreateLocation {
  readonly name: string
  readonly kind: LocationKind
  readonly address: string | null
  readonly iata: string | null
  readonly place: LocationPlace | null
}

/**
 * PATCH /api/locations/:id. A field that is absent stays as it is.
 * Archive is a separate route, so this body cannot set archivedAt.
 */
export const locationPatchSchema = z.strictObject({
  name: locationNameSchema.optional(),
  kind: locationKindSchema.optional(),
  address: locationAddressSchema.optional(),
  iata: locationIataSchema.optional(),
  place: locationPlaceSchema.nullable().optional(),
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
  const iata = parsed.data.iata === undefined ? null : parsed.data.iata
  // A hotel, an address, or any other kind cannot carry a code. The writer
  // repeats this once it can see the row the patch lands on.
  if (parsed.data.kind !== 'airport' && iata !== null)
    throw new LocationInputError()
  const address = parsed.data.address === undefined ? null : parsed.data.address
  const place = parsed.data.place === undefined ? null : parsed.data.place
  // A reference with no address would open a different place from the text.
  if (place !== null && address === null)
    throw new LocationInputError()
  return {
    name: parsed.data.name,
    kind: parsed.data.kind,
    address,
    iata,
    place,
  }
}

/** Accepts a correction. Any other body throws first. */
export function parseLocationPatch(raw: unknown): LocationPatch {
  const parsed = locationPatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new LocationInputError()
  // The body itself names a non-airport and a code. The current row is not
  // needed to refuse that. A code on a row that is already a hotel is refused
  // when the patch is applied.
  if (parsed.data.kind !== undefined && parsed.data.kind !== 'airport' && parsed.data.iata)
    throw new LocationInputError()
  // Clearing the address and sending a place in the same body is a place
  // with no address. The writer refuses that before it opens a session.
  if (parsed.data.place && parsed.data.address === null)
    throw new LocationInputError()
  return parsed.data
}

/**
 * POST /api/locations/suggestions. The typed address is `text`.
 * It is trimmed, at least three characters, and no longer than an address.
 * The session token groups one typing run for the provider. An unknown key
 * is refused. The message stays "Bad request" and does not echo the text.
 */
export const suggestAddressesSchema = z.strictObject({
  text: z.string().trim().min(LOCATION_SUGGEST_MIN_LENGTH).max(LOCATION_ADDRESS_MAX_LENGTH),
  sessionToken: z.uuid(),
})

export interface SuggestAddressesInput {
  readonly text: string
  readonly sessionToken: string
}

export const addressSuggestionSchema = z.object({
  text: z.string().min(1).max(LOCATION_ADDRESS_MAX_LENGTH),
  provider: placeProviderSchema,
  placeRef: z.string().min(1).max(PLACE_REF_MAX_LENGTH),
})

export type AddressSuggestion = z.infer<typeof addressSuggestionSchema>

/**
 * The route always answers this shape. Unavailable is an empty list and no
 * attribution, so the form can stay a plain address field.
 */
export const suggestAddressesResponseSchema = z.object({
  available: z.boolean(),
  suggestions: z.array(addressSuggestionSchema),
  attribution: z.string().min(1).nullable(),
}).superRefine((value, ctx) => {
  if (!value.available && (value.suggestions.length > 0 || value.attribution !== null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Unavailable suggestions have no list.',
    })
  }
})

export type SuggestAddressesResponse = z.infer<typeof suggestAddressesResponseSchema>

/** Accepts a suggestion lookup. Any other body throws first, so the caller does not open a session. */
export function parseSuggestAddresses(raw: unknown): SuggestAddressesInput {
  const parsed = suggestAddressesSchema.safeParse(raw)
  if (!parsed.success)
    throw new LocationInputError()
  return parsed.data
}

export type LocationNameError = 'empty' | 'too-long'
export type LocationKindError = 'invalid'
export type LocationAddressError = 'too-long'
export type LocationIataError = 'invalid'

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

/**
 * The name a Ride shows or offers in a picker. A code is appended only when
 * this Location has one, so a hotel stays its name.
 */
export function locationLabel(location: { readonly name: string, readonly iata: string | null }): string {
  if (location.iata === null)
    return location.name
  return `${location.name} (${location.iata})`
}

/** Blank is allowed. Anything else must be three ASCII letters. */
export function locationIataError(value: string): LocationIataError | null {
  const trimmed = value.trim()
  if (trimmed.length === 0)
    return null
  return /^[a-z]{3}$/i.test(trimmed) ? null : 'invalid'
}
