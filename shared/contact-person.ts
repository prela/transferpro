import { z } from 'zod'
import { CLIENT_NAME_MAX_LENGTH, clientNameSchema } from './client'
import { DRIVER_EMAIL_MAX_LENGTH, DRIVER_PHONE_MAX_LENGTH, driverEmailSchema, driverPhoneSchema } from './driver'

/**
 * A contact person's name uses the Client name bound: long enough for a
 * person at an agency, short enough that a pasted paragraph is refused.
 */
export const CONTACT_PERSON_NAME_MAX_LENGTH = CLIENT_NAME_MAX_LENGTH

/**
 * A role is free text, such as booking or accounting. 100 characters is a
 * label, not a note. ADR-0049.
 */
export const CONTACT_PERSON_ROLE_MAX_LENGTH = 100

/**
 * The only strings an audit row may store for a contact person.
 * The name, the role text, the phone, and the email are not in this list.
 */
export const CONTACT_PERSON_FIELDS = ['name', 'role', 'phone', 'email'] as const

export type ContactPersonField = (typeof CONTACT_PERSON_FIELDS)[number]

/** Canonical order is the field list order, so two saves record the same array. */
function fieldLists(fields: readonly ContactPersonField[]): ContactPersonField[][] {
  const lists: ContactPersonField[][] = []
  const count = 1 << fields.length
  for (let mask = 1; mask < count; mask += 1)
    lists.push(fields.filter((_, index) => (mask & (1 << index)) !== 0))
  return lists
}

/** Every non-empty combination, each in canonical order. A correction records one of these. */
export const CONTACT_PERSON_CHANGED_FIELD_LISTS = fieldLists(CONTACT_PERSON_FIELDS)

/**
 * An add always records the name, and a phone, an email, or both.
 * A role is recorded only when one was set. A contact with neither
 * phone nor email is not a list here, so it cannot be an audit row.
 */
export const CONTACT_PERSON_ADDED_FIELD_LISTS = CONTACT_PERSON_CHANGED_FIELD_LISTS.filter(
  list => list.includes('name') && (list.includes('phone') || list.includes('email')),
)

const contactPersonFieldSchema = z.enum(CONTACT_PERSON_FIELDS)

function exactFieldLists(lists: readonly (readonly string[])[]) {
  return z.array(contactPersonFieldSchema).refine(value => lists.some(
    list => list.length === value.length && list.every((item, index) => item === value[index]),
  ))
}

export const contactPersonAddedFieldsSchema = exactFieldLists(CONTACT_PERSON_ADDED_FIELD_LISTS)
export const contactPersonChangedFieldsSchema = exactFieldLists(CONTACT_PERSON_CHANGED_FIELD_LISTS)

/** One contact person on the Client card. A removed one is not in this shape. */
export const contactPersonSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  name: clientNameSchema,
  role: z.string().trim().min(1).max(CONTACT_PERSON_ROLE_MAX_LENGTH).nullable(),
  phone: driverPhoneSchema.nullable(),
  email: driverEmailSchema.nullable(),
  version: z.number().int().nonnegative(),
  changedAt: z.iso.datetime().nullable(),
  changedByName: z.string().min(1).nullable(),
}).refine(person => person.phone !== null || person.email !== null)

export type ContactPerson = z.infer<typeof contactPersonSchema>

export const contactPersonListSchema = z.object({
  contactPersons: z.array(contactPersonSchema),
})

export type ContactPersonList = z.infer<typeof contactPersonListSchema>

/** POST .../contact-persons. An unknown key is refused. Adding sends no version. */
const contactPersonBodySchema = z.strictObject({
  name: clientNameSchema,
  role: z.string().trim().max(CONTACT_PERSON_ROLE_MAX_LENGTH).nullable().optional(),
  phone: z.string().trim().max(DRIVER_PHONE_MAX_LENGTH).nullable().optional(),
  email: z.string().trim().max(DRIVER_EMAIL_MAX_LENGTH).nullable().optional(),
})

/**
 * PATCH .../contact-persons/:contactPersonId. An absent field stays.
 * Null clears the role, the phone, or the email. The version is required.
 */
export const contactPersonPatchBodySchema = contactPersonBodySchema.omit({ name: true }).extend({
  name: clientNameSchema.optional(),
  version: z.number().int().nonnegative(),
})

/** POST .../remove. The version is the only field. An unknown key is refused. */
export const removeContactPersonSchema = z.strictObject({
  version: z.number().int().nonnegative(),
})

export type RemoveContactPerson = z.infer<typeof removeContactPersonSchema>

export interface ContactPersonWrite {
  readonly name: string
  readonly role: string | null
  readonly phone: string | null
  readonly email: string | null
}

export interface ContactPersonPatch extends Partial<ContactPersonWrite> {
  readonly version: number
}

/** The body was not a valid contact person. Nothing is written. */
export class ContactPersonInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'ContactPersonInputError'
  }
}

/** Blank text clears the field. A present value has to pass the Driver check. */
function optionalContact(value: string | null | undefined, accept: (value: string) => boolean): string | null | undefined {
  if (value === undefined)
    return undefined
  if (value === null || value === '')
    return null
  if (!accept(value))
    throw new ContactPersonInputError()
  return value
}

function presentContact(value: string | null | undefined, accept: (value: string) => boolean): string | null {
  const contact = optionalContact(value, accept)
  return contact === undefined ? null : contact
}

/**
 * Accepts a new contact person. Any other body throws first, so the caller
 * does not open a session. A phone, an email, or both is required.
 */
export function parseCreateContactPerson(raw: unknown): ContactPersonWrite {
  const parsed = contactPersonBodySchema.safeParse(raw)
  if (!parsed.success)
    throw new ContactPersonInputError()
  const contact: ContactPersonWrite = {
    name: parsed.data.name,
    role: presentContact(parsed.data.role, value => value.length <= CONTACT_PERSON_ROLE_MAX_LENGTH),
    phone: presentContact(parsed.data.phone, value => driverPhoneSchema.safeParse(value).success),
    email: presentContact(parsed.data.email, value => driverEmailSchema.safeParse(value).success),
  }
  // Omitted and blank are the same on an add: the field was not given.
  if (contact.phone === null && contact.email === null)
    throw new ContactPersonInputError()
  return contact
}

/** Accepts a correction. A missing version is refused before a session opens. */
export function parseContactPersonPatch(raw: unknown): ContactPersonPatch {
  const parsed = contactPersonPatchBodySchema.safeParse(raw)
  if (!parsed.success)
    throw new ContactPersonInputError()
  const role = optionalContact(parsed.data.role, value => value.length <= CONTACT_PERSON_ROLE_MAX_LENGTH)
  const phone = optionalContact(parsed.data.phone, value => driverPhoneSchema.safeParse(value).success)
  const email = optionalContact(parsed.data.email, value => driverEmailSchema.safeParse(value).success)
  return {
    version: parsed.data.version,
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
    ...(role === undefined ? {} : { role }),
    ...(phone === undefined ? {} : { phone }),
    ...(email === undefined ? {} : { email }),
  }
}

export function parseRemoveContactPerson(raw: unknown): RemoveContactPerson {
  const parsed = removeContactPersonSchema.safeParse(raw)
  if (!parsed.success)
    throw new ContactPersonInputError()
  return parsed.data
}

/** Fields an add records, in canonical order. The name is always one of them. */
export function addedContactPersonFields(input: ContactPersonWrite): ContactPersonField[] {
  const fields: ContactPersonField[] = ['name']
  if (input.role !== null)
    fields.push('role')
  if (input.phone !== null)
    fields.push('phone')
  if (input.email !== null)
    fields.push('email')
  return fields
}
