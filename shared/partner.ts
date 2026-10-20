import { z } from 'zod'
import { driverEmailSchema, driverPhoneSchema } from './driver'

/**
 * A Partner name. 200 matches a Driver name: long enough for a company,
 * short enough that a pasted paragraph is refused. The name is not unique
 * (ADR-0049).
 */
export const PARTNER_NAME_MAX_LENGTH = 200

/**
 * One standing note. 2000 matches the Client note: a short instruction,
 * not a call log. ADR-0049.
 */
export const PARTNER_NOTE_MAX_LENGTH = 2000

/**
 * The only strings an audit row may store for a Partner.
 * The name, the phone, the email, and the note text are not values here:
 * they are field names, and the row is never deleted.
 */
export const PARTNER_FIELDS = ['name', 'phone', 'email', 'note'] as const

export type PartnerField = (typeof PARTNER_FIELDS)[number]

/** Canonical order is the field list order, so two saves record the same array. */
function fieldLists(fields: readonly PartnerField[]): PartnerField[][] {
  const lists: PartnerField[][] = []
  const count = 1 << fields.length
  for (let mask = 1; mask < count; mask += 1)
    lists.push(fields.filter((_, index) => (mask & (1 << index)) !== 0))
  return lists
}

/** Every non-empty combination, each in canonical order. A correction records one of these. */
export const PARTNER_CHANGED_FIELD_LISTS = fieldLists(PARTNER_FIELDS)

/**
 * A create always records the name. Phone, email, and note are recorded
 * only when one was set. A list without the name cannot be an audit row.
 */
export const PARTNER_CREATED_FIELD_LISTS = PARTNER_CHANGED_FIELD_LISTS.filter(list => list.includes('name'))

const partnerFieldSchema = z.enum(PARTNER_FIELDS)

function exactFieldLists(lists: readonly (readonly string[])[]) {
  return z.array(partnerFieldSchema).refine(value => lists.some(
    list => list.length === value.length && list.every((item, index) => item === value[index]),
  ))
}

export const partnerCreatedFieldsSchema = exactFieldLists(PARTNER_CREATED_FIELD_LISTS)
export const partnerChangedFieldsSchema = exactFieldLists(PARTNER_CHANGED_FIELD_LISTS)

export const partnerNameSchema = z.string().trim().min(1).max(PARTNER_NAME_MAX_LENGTH)

/** A stored note. Blank is null on the row, not an empty string. */
export const partnerNoteSchema = z.string().trim().min(1).max(PARTNER_NOTE_MAX_LENGTH)

export const partnerSchema = z.object({
  id: z.uuid(),
  name: partnerNameSchema,
  phone: driverPhoneSchema.nullable(),
  email: driverEmailSchema.nullable(),
  note: partnerNoteSchema.nullable(),
  // Null while the Partner is on the default list. Archive is its own route.
  archivedAt: z.iso.datetime().nullable(),
})

export type Partner = z.infer<typeof partnerSchema>

export const partnerListSchema = z.object({
  partners: z.array(partnerSchema),
})

export type PartnerList = z.infer<typeof partnerListSchema>

export interface CreatePartner {
  readonly name: string
  readonly phone: string | null
  readonly email: string | null
  readonly note: string | null
}

/** A field that is absent stays as it is. Archive is a separate route. */
export interface PartnerPatch {
  readonly name?: string
  readonly phone?: string | null
  readonly email?: string | null
  readonly note?: string | null
}

/**
 * POST /api/partners. Phone, email, and note are optional text so a blank
 * can become null before the Driver check. An unknown key is refused.
 * Archive is absent: a new Partner starts on the list.
 */
const createPartnerSchema = z.strictObject({
  name: z.string(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

/**
 * PATCH /api/partners/:id. A field that is absent stays as it is.
 * This body cannot set archivedAt.
 */
const partnerPatchSchema = z.strictObject({
  name: z.string().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

/** The body was not a valid Partner. Nothing is written. The name is not in the message. */
export class PartnerInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'PartnerInputError'
  }
}

/**
 * Blank text clears the field. A present value has to pass the same check
 * a Driver uses for a phone or an email, or the note length.
 */
function optionalText(
  value: string | null | undefined,
  accept: (value: string) => boolean,
): string | null | undefined {
  if (value === undefined)
    return undefined
  if (value === null)
    return null
  const trimmed = value.trim()
  if (trimmed === '')
    return null
  if (!accept(trimmed))
    throw new PartnerInputError()
  return trimmed
}

function presentText(value: string | null | undefined, accept: (value: string) => boolean): string | null {
  const text = optionalText(value, accept)
  return text === undefined ? null : text
}

function acceptPhone(value: string): boolean {
  return driverPhoneSchema.safeParse(value).success
}

function acceptEmail(value: string): boolean {
  return driverEmailSchema.safeParse(value).success
}

function acceptNote(value: string): boolean {
  return value.length <= PARTNER_NOTE_MAX_LENGTH
}

function requiredName(value: string): string {
  const parsed = partnerNameSchema.safeParse(value)
  if (!parsed.success)
    throw new PartnerInputError()
  return parsed.data
}

/** Accepts a new Partner. Any other body throws first, so the caller does not open a session. */
export function parseCreatePartner(raw: unknown): CreatePartner {
  const parsed = createPartnerSchema.safeParse(raw)
  if (!parsed.success)
    throw new PartnerInputError()
  return {
    name: requiredName(parsed.data.name),
    phone: presentText(parsed.data.phone, acceptPhone),
    email: presentText(parsed.data.email, acceptEmail),
    note: presentText(parsed.data.note, acceptNote),
  }
}

/** Accepts a correction. Any other body throws first. */
export function parsePartnerPatch(raw: unknown): PartnerPatch {
  const parsed = partnerPatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new PartnerInputError()
  return {
    ...(parsed.data.name === undefined ? {} : { name: requiredName(parsed.data.name) }),
    ...(parsed.data.phone === undefined ? {} : { phone: optionalText(parsed.data.phone, acceptPhone) ?? null }),
    ...(parsed.data.email === undefined ? {} : { email: optionalText(parsed.data.email, acceptEmail) ?? null }),
    ...(parsed.data.note === undefined ? {} : { note: optionalText(parsed.data.note, acceptNote) ?? null }),
  }
}

/** Field names written on create, in canonical order. A blank contact is not a field. */
export function partnerCreatedFields(input: CreatePartner): PartnerField[] {
  const fields: PartnerField[] = ['name']
  if (input.phone !== null)
    fields.push('phone')
  if (input.email !== null)
    fields.push('email')
  if (input.note !== null)
    fields.push('note')
  return fields
}

/** Field names whose stored value changed, in canonical order. */
export function partnerChangedFields(
  current: Pick<Partner, PartnerField>,
  next: Pick<Partner, PartnerField>,
): PartnerField[] {
  return PARTNER_FIELDS.filter(field => next[field] !== current[field])
}
