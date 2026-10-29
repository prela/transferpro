import type { IsoCountry } from './iso-country'
import { z } from 'zod'
import { ISO_3166_1_ALPHA_2 } from './iso-country'

/**
 * A legal name fits an agency or a hotel company, and 200 is the Client
 * name bound. A pasted paragraph is refused. ADR-0051.
 */
export const BILLING_LEGAL_NAME_MAX_LENGTH = 200

/** One address line. 300 covers a street, a city, and a postcode. */
export const BILLING_ADDRESS_MAX_LENGTH = 300

/** A VAT id is optional. 20 is enough for an EU VAT number and a short extra. */
export const BILLING_VAT_ID_MAX_LENGTH = 20

/** Croatia. An OIB is required only for this country (ADR-0051). */
export const BILLING_OIB_COUNTRY = 'HR'

/**
 * The only strings an audit row may store for billing details.
 * The legal name, the OIB, the VAT id, and the address are not in this list
 * as values. They are personal data (ADR-0051).
 */
export const BILLING_DETAILS_FIELDS = [
  'legalName',
  'country',
  'oib',
  'vatId',
  'address',
  'guestNameOnInvoice',
] as const

export type BillingDetailsField = (typeof BILLING_DETAILS_FIELDS)[number]

/** Canonical order is the field list order, so two saves record the same array. */
function fieldLists(fields: readonly BillingDetailsField[]): BillingDetailsField[][] {
  const lists: BillingDetailsField[][] = []
  const count = 1 << fields.length
  for (let mask = 1; mask < count; mask += 1)
    lists.push(fields.filter((_, index) => (mask & (1 << index)) !== 0))
  return lists
}

/** Every non-empty combination, each in canonical order. A save records one of these. */
export const BILLING_DETAILS_FIELD_LISTS = fieldLists(BILLING_DETAILS_FIELDS)

const billingFieldSchema = z.enum(BILLING_DETAILS_FIELDS)

export const billingDetailsFieldsSchema = z.array(billingFieldSchema).refine(value =>
  BILLING_DETAILS_FIELD_LISTS.some(list =>
    list.length === value.length && list.every((item, index) => item === value[index])),
)

export const isoCountrySchema = z.enum(ISO_3166_1_ALPHA_2)

/**
 * The values a billing row holds, or the empty card before the first save.
 * Null is "not set". The guest checkbox starts off.
 */
export interface BillingDetailsValues {
  readonly legalName: string | null
  readonly country: IsoCountry | null
  readonly oib: string | null
  readonly vatId: string | null
  readonly address: string | null
  readonly guestNameOnInvoice: boolean
}

/** No row yet. The first save sends no version, and the checkbox is off. */
export const EMPTY_BILLING_DETAILS: BillingDetailsValues = {
  legalName: null,
  country: null,
  oib: null,
  vatId: null,
  address: null,
  guestNameOnInvoice: false,
}

/**
 * ISO 7064 MOD 11,10, the check the Croatian OIB uses.
 * The expected digit is a known literal in the test, not this function.
 */
function oibCheckDigit(body: string): number {
  let remainder = 10
  for (const character of body) {
    let sum = (Number(character) + remainder) % 10
    if (sum === 0)
      sum = 10
    remainder = (2 * sum) % 11
  }
  const digit = 11 - remainder
  return digit === 10 ? 0 : digit
}

/** Eleven digits whose last digit is the ISO 7064 check. Anything else is false. */
export function isValidOib(value: string): boolean {
  if (!/^\d{11}$/.test(value))
    return false
  return oibCheckDigit(value.slice(0, 10)) === Number(value[10])
}

/**
 * Complete when the legal name, the country, and the address are set, and
 * the OIB is set when the country is Croatia. A VAT id is optional.
 * No row is incomplete. ADR-0051.
 */
export function billingDetailsAreComplete(details: Pick<BillingDetailsValues, 'legalName' | 'country' | 'oib' | 'address'>): boolean {
  if (details.legalName === null || details.country === null || details.address === null)
    return false
  if (details.country === BILLING_OIB_COUNTRY && details.oib === null)
    return false
  return true
}

/** The fields that differ, in canonical order. An empty list is a save that changes nothing. */
export function billingDetailsChangedFields(before: BillingDetailsValues, after: BillingDetailsValues): BillingDetailsField[] {
  return BILLING_DETAILS_FIELDS.filter(field => before[field] !== after[field])
}

/**
 * What the card and invoicing read. `complete` is derived, not stored.
 * Null text is no row yet. A row always has a version.
 */
export const clientBillingSchema = z.object({
  clientId: z.uuid(),
  legalName: z.string().trim().min(1).max(BILLING_LEGAL_NAME_MAX_LENGTH).nullable(),
  country: isoCountrySchema.nullable(),
  oib: z.string().nullable(),
  vatId: z.string().trim().min(1).max(BILLING_VAT_ID_MAX_LENGTH).nullable(),
  address: z.string().trim().min(1).max(BILLING_ADDRESS_MAX_LENGTH).nullable(),
  guestNameOnInvoice: z.boolean(),
  complete: z.boolean(),
  version: z.number().int().nonnegative().nullable(),
  changedAt: z.iso.datetime().nullable(),
  changedByName: z.string().min(1).nullable(),
}).refine((row) => {
  const values = {
    legalName: row.legalName,
    country: row.country,
    oib: row.oib,
    address: row.address,
  }
  if (row.complete !== billingDetailsAreComplete(values))
    return false
  if (row.oib !== null && !isValidOib(row.oib))
    return false
  if (row.version === null)
    return row.legalName === null && row.country === null && row.oib === null && row.vatId === null && row.address === null && row.guestNameOnInvoice === false && row.changedAt === null && row.changedByName === null
  return row.legalName !== null && row.country !== null && row.address !== null && row.changedAt !== null
})

export type ClientBilling = z.infer<typeof clientBillingSchema>

/**
 * PUT /api/clients/:id/billing-details. An unknown key is refused.
 * The first save omits `version`. A later save sends the version the form opened with.
 */
const clientBillingSaveSchema = z.strictObject({
  legalName: z.string(),
  country: z.string(),
  oib: z.string().nullable(),
  vatId: z.string().nullable(),
  address: z.string(),
  guestNameOnInvoice: z.boolean(),
  version: z.number().int().nonnegative().optional(),
})

export interface ClientBillingSave {
  readonly legalName: string
  readonly country: IsoCountry
  readonly oib: string | null
  readonly vatId: string | null
  readonly address: string
  readonly guestNameOnInvoice: boolean
  /** Absent on the first save. A later save sends the opened version. */
  readonly version?: number
}

/** The body was not valid billing details. Nothing is written. No value is in the message. */
export class ClientBillingInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'ClientBillingInputError'
  }
}

function trimmedOrNull(value: string | null): string | null {
  if (value === null)
    return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Accepts a billing-details save. Any other body throws first, so the caller
 * does not open a session. Blank OIB and VAT id are null. The country is
 * stored in uppercase. An OIB is required when the country is HR.
 */
export function parseClientBillingSave(raw: unknown): ClientBillingSave {
  const parsed = clientBillingSaveSchema.safeParse(raw)
  if (!parsed.success)
    throw new ClientBillingInputError()
  const legalName = parsed.data.legalName.trim()
  if (legalName.length < 1 || legalName.length > BILLING_LEGAL_NAME_MAX_LENGTH)
    throw new ClientBillingInputError()
  const country = isoCountrySchema.safeParse(parsed.data.country.trim().toUpperCase())
  if (!country.success)
    throw new ClientBillingInputError()
  const address = parsed.data.address.trim()
  if (address.length < 1 || address.length > BILLING_ADDRESS_MAX_LENGTH)
    throw new ClientBillingInputError()
  const oib = trimmedOrNull(parsed.data.oib)
  if (oib !== null && !isValidOib(oib))
    throw new ClientBillingInputError()
  if (country.data === BILLING_OIB_COUNTRY && oib === null)
    throw new ClientBillingInputError()
  const vatId = trimmedOrNull(parsed.data.vatId)
  if (vatId !== null && vatId.length > BILLING_VAT_ID_MAX_LENGTH)
    throw new ClientBillingInputError()
  const save: ClientBillingSave = {
    legalName,
    country: country.data,
    oib,
    vatId,
    address,
    guestNameOnInvoice: parsed.data.guestNameOnInvoice,
  }
  return parsed.data.version === undefined ? save : { ...save, version: parsed.data.version }
}
