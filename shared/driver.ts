import { z } from 'zod'
import { isCalendarDate } from './date'

/**
 * A person's name. 200 matches a Client name: long enough for a full name,
 * short enough that a pasted paragraph is refused.
 */
export const DRIVER_NAME_MAX_LENGTH = 200

/**
 * A contact number with spaces. E.164 is 15 digits; 40 leaves room for a
 * local shape and refuses a note pasted into the field.
 */
export const DRIVER_PHONE_MAX_LENGTH = 40

/** Better Auth user ids are short text. 64 refuses a pasted sentence. */
export const DRIVER_MEMBER_ID_MAX_LENGTH = 64

/** Own fleet, or a driver the office confirms by phone. */
export const DRIVER_KINDS = ['own', 'external'] as const

/**
 * The only strings an audit row may store for a Driver change.
 * Values (the phone, the dates, the kind) are not in this list.
 */
export const DRIVER_FIELDS = [
  'name',
  'kind',
  'phone',
  'drivingLicenceExpiresOn',
  'transportLicenceExpiresOn',
  'memberUserId',
  'mustAccept',
] as const

export const driverKindSchema = z.enum(DRIVER_KINDS)

export type DriverKind = z.infer<typeof driverKindSchema>

export const driverFieldSchema = z.enum(DRIVER_FIELDS)

export type DriverField = z.infer<typeof driverFieldSchema>

export const driverNameSchema = z.string().trim().min(1).max(DRIVER_NAME_MAX_LENGTH)

export const driverPhoneSchema = z.string().trim().min(1).max(DRIVER_PHONE_MAX_LENGTH)

export const driverDateSchema = z.string().refine(isCalendarDate)

const memberIdSchema = z.string().trim().min(1).max(DRIVER_MEMBER_ID_MAX_LENGTH)

export const driverSchema = z.object({
  id: z.uuid(),
  name: driverNameSchema,
  kind: driverKindSchema,
  phone: driverPhoneSchema,
  drivingLicenceExpiresOn: driverDateSchema,
  transportLicenceExpiresOn: driverDateSchema,
  memberUserId: memberIdSchema.nullable(),
  mustAccept: z.boolean(),
})

export type Driver = z.infer<typeof driverSchema>

export const driverListSchema = z.object({
  drivers: z.array(driverSchema),
})

export type DriverList = z.infer<typeof driverListSchema>

/**
 * POST /api/drivers. Must-accept is absent: a new Driver starts off.
 * An unknown key is refused. `memberUserId` null means no account.
 */
export const createDriverSchema = z.strictObject({
  name: driverNameSchema,
  kind: driverKindSchema,
  phone: driverPhoneSchema,
  drivingLicenceExpiresOn: driverDateSchema,
  transportLicenceExpiresOn: driverDateSchema,
  memberUserId: memberIdSchema.nullable().optional(),
})

export interface CreateDriver {
  readonly name: string
  readonly kind: DriverKind
  readonly phone: string
  readonly drivingLicenceExpiresOn: string
  readonly transportLicenceExpiresOn: string
  readonly memberUserId?: string
}

/**
 * PATCH /api/drivers/:id. A field that is absent stays as it is.
 * `memberUserId` null clears the link. An empty object changes nothing.
 */
export const driverPatchSchema = z.strictObject({
  name: driverNameSchema.optional(),
  kind: driverKindSchema.optional(),
  phone: driverPhoneSchema.optional(),
  drivingLicenceExpiresOn: driverDateSchema.optional(),
  transportLicenceExpiresOn: driverDateSchema.optional(),
  memberUserId: memberIdSchema.nullable().optional(),
  mustAccept: z.boolean().optional(),
})

export type DriverPatch = z.infer<typeof driverPatchSchema>

/** The body was not a valid Driver. Nothing is written. The phone is not in the message. */
export class DriverInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'DriverInputError'
  }
}

/** Accepts a new Driver. Any other body throws first, so the caller does not open a session. */
export function parseCreateDriver(raw: unknown): CreateDriver {
  const parsed = createDriverSchema.safeParse(raw)
  if (!parsed.success)
    throw new DriverInputError()
  const { memberUserId, ...rest } = parsed.data
  if (memberUserId === undefined || memberUserId === null)
    return rest
  return { ...rest, memberUserId }
}

/** Accepts a correction. Any other body throws first. */
export function parseDriverPatch(raw: unknown): DriverPatch {
  const parsed = driverPatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new DriverInputError()
  return parsed.data
}

export type DriverNameError = 'empty' | 'too-long'
export type DriverPhoneError = 'empty' | 'too-long'
export type DriverKindError = 'invalid'
export type DriverDateError = 'invalid'

/** What the add and edit forms can tell the person before a request. */
export function driverNameError(name: string): DriverNameError | null {
  const trimmed = name.trim()
  if (trimmed.length === 0)
    return 'empty'
  if (trimmed.length > DRIVER_NAME_MAX_LENGTH)
    return 'too-long'
  return null
}

export function driverPhoneError(phone: string): DriverPhoneError | null {
  const trimmed = phone.trim()
  if (trimmed.length === 0)
    return 'empty'
  if (trimmed.length > DRIVER_PHONE_MAX_LENGTH)
    return 'too-long'
  return null
}

export function driverKindError(kind: string): DriverKindError | null {
  return driverKindSchema.safeParse(kind).success ? null : 'invalid'
}

export function driverDateError(value: string): DriverDateError | null {
  return isCalendarDate(value) ? null : 'invalid'
}
