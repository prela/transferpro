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

/**
 * One mailbox. 254 is the longest address a mail transfer can carry.
 * Longer text is a note pasted into the field.
 */
export const DRIVER_EMAIL_MAX_LENGTH = 254

/** Own fleet, or a driver the office confirms by phone. */
export const DRIVER_KINDS = ['own', 'external'] as const

/**
 * The only strings an audit row may store for a Driver change.
 * Values (the phone, the email, the dates, the kind) are not in this list.
 */
export const DRIVER_FIELDS = [
  'name',
  'kind',
  'phone',
  'email',
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

/** A stored address. Blank is null on the row, not an empty string. */
export const driverEmailSchema = z.string().trim().min(1).max(DRIVER_EMAIL_MAX_LENGTH).refine(
  value => z.email().safeParse(value).success,
)

export const driverDateSchema = z.string().refine(isCalendarDate)

const memberIdSchema = z.string().trim().min(1).max(DRIVER_MEMBER_ID_MAX_LENGTH)

export const driverSchema = z.object({
  id: z.uuid(),
  name: driverNameSchema,
  kind: driverKindSchema,
  phone: driverPhoneSchema,
  email: driverEmailSchema.nullable(),
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
 * `email` is optional. A blank is omitted. A body that names an account
 * and also supplies an email is refused: the sign-in address is copied.
 */
export const createDriverSchema = z.strictObject({
  name: driverNameSchema,
  kind: driverKindSchema,
  phone: driverPhoneSchema,
  email: z.string().trim().max(DRIVER_EMAIL_MAX_LENGTH).nullable().optional(),
  drivingLicenceExpiresOn: driverDateSchema,
  transportLicenceExpiresOn: driverDateSchema,
  memberUserId: memberIdSchema.nullable().optional(),
})

export interface CreateDriver {
  readonly name: string
  readonly kind: DriverKind
  readonly phone: string
  readonly email?: string
  readonly drivingLicenceExpiresOn: string
  readonly transportLicenceExpiresOn: string
  readonly memberUserId?: string
}

/**
 * PATCH /api/drivers/:id. A field that is absent stays as it is.
 * `memberUserId` null clears the link. `email` null clears the address.
 * An email together with a member id is refused. An empty object changes nothing.
 */
export const driverPatchSchema = z.strictObject({
  name: driverNameSchema.optional(),
  kind: driverKindSchema.optional(),
  phone: driverPhoneSchema.optional(),
  email: z.string().trim().max(DRIVER_EMAIL_MAX_LENGTH).nullable().optional(),
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
  const { memberUserId, email, ...rest } = parsed.data
  // A linked Driver takes the sign-in email. A supplied address is not stored in its place.
  if (memberUserId !== undefined && memberUserId !== null && email !== undefined)
    throw new DriverInputError()
  const address = normalizeEmail(email)
  const withEmail = address === undefined || address === null ? rest : { ...rest, email: address }
  if (memberUserId === undefined || memberUserId === null)
    return withEmail
  return { ...withEmail, memberUserId }
}

/** Accepts a correction. Any other body throws first. */
export function parseDriverPatch(raw: unknown): DriverPatch {
  const parsed = driverPatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new DriverInputError()
  // Linking and typing an address in one body is refused. Unlinking may edit the address.
  if (parsed.data.memberUserId !== undefined && parsed.data.memberUserId !== null && parsed.data.email !== undefined)
    throw new DriverInputError()
  if (parsed.data.email === undefined)
    return parsed.data
  const address = normalizeEmail(parsed.data.email)
  return { ...parsed.data, email: address ?? null }
}

/**
 * Blank becomes null. Anything that is not an address throws, so the caller
 * does not open a session. The address is not put on the error.
 */
function normalizeEmail(email: string | null | undefined): string | null | undefined {
  if (email === undefined)
    return undefined
  if (email === null || email === '')
    return null
  if (!z.email().safeParse(email).success)
    throw new DriverInputError()
  return email
}

export type DriverNameError = 'empty' | 'too-long'
export type DriverPhoneError = 'empty' | 'too-long'
export type DriverEmailError = 'invalid'
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

/** Blank is allowed. The office may leave an unlinked Driver without an address. */
export function driverEmailError(email: string): DriverEmailError | null {
  const trimmed = email.trim()
  if (trimmed.length === 0)
    return null
  if (trimmed.length > DRIVER_EMAIL_MAX_LENGTH || !z.email().safeParse(trimmed).success)
    return 'invalid'
  return null
}

export function driverKindError(kind: string): DriverKindError | null {
  return driverKindSchema.safeParse(kind).success ? null : 'invalid'
}

export function driverDateError(value: string): DriverDateError | null {
  return isCalendarDate(value) ? null : 'invalid'
}
