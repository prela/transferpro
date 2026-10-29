import { z } from 'zod'

/**
 * Invoicing settings for one Tenant (ADR-0051). Due days, the VAT rate,
 * and the line text are ordinary settings. The current tool's token is not:
 * the screen and the API see only whether it is set and its last four
 * characters. The ciphertext stays in the database.
 */

/** Inclusive. 0 is due on issue. A year is the longest term the form offers. */
export const INVOICING_DUE_DAYS_MIN = 0
export const INVOICING_DUE_DAYS_MAX = 365
export const INVOICING_DUE_DAYS_DEFAULT = 15

/** Croatian VAT rates the current tool is asked to use. 25 is the start. */
export const INVOICING_VAT_RATES = [0, 5, 13, 25] as const
export const INVOICING_VAT_RATE_DEFAULT = 25

export const INVOICING_LINE_TEXT_MAX_LENGTH = 100
export const INVOICING_LINE_TEXT_DEFAULT = 'Transfer'

/**
 * Shorter than this and the last four characters would be the whole token.
 * Longer than this is not a token the form is meant to hold.
 */
export const INVOICING_TOKEN_MIN_LENGTH = 8
export const INVOICING_TOKEN_MAX_LENGTH = 200

/**
 * The only strings an audit row may store for an invoicing settings change.
 * The token is the field name `token`. Its value is never one of these.
 */
export const INVOICING_SETTINGS_FIELDS = ['dueDays', 'vatRate', 'lineText', 'token'] as const

export type InvoicingSettingsField = (typeof INVOICING_SETTINGS_FIELDS)[number]

/** Canonical order is the field list order, so two saves record the same array. */
function fieldLists(fields: readonly InvoicingSettingsField[]): InvoicingSettingsField[][] {
  const lists: InvoicingSettingsField[][] = []
  const count = 1 << fields.length
  for (let mask = 1; mask < count; mask += 1)
    lists.push(fields.filter((_, index) => (mask & (1 << index)) !== 0))
  return lists
}

/** Every non-empty combination, each in canonical order. A save records one of these. */
export const INVOICING_SETTINGS_FIELD_LISTS = fieldLists(INVOICING_SETTINGS_FIELDS)

const invoicingFieldSchema = z.enum(INVOICING_SETTINGS_FIELDS)

export const invoicingSettingsFieldsSchema = z.array(invoicingFieldSchema).refine(value =>
  INVOICING_SETTINGS_FIELD_LISTS.some(list =>
    list.length === value.length && list.every((item, index) => item === value[index])),
)

export const invoicingVatRateSchema = z.union([
  z.literal(INVOICING_VAT_RATES[0]),
  z.literal(INVOICING_VAT_RATES[1]),
  z.literal(INVOICING_VAT_RATES[2]),
  z.literal(INVOICING_VAT_RATES[3]),
])

export type InvoicingVatRate = z.infer<typeof invoicingVatRateSchema>

/** What the screen shows. There is no token field. */
export const invoicingSettingsSchema = z.strictObject({
  dueDays: z.number().int().min(INVOICING_DUE_DAYS_MIN).max(INVOICING_DUE_DAYS_MAX),
  vatRate: invoicingVatRateSchema,
  lineText: z.string().min(1).max(INVOICING_LINE_TEXT_MAX_LENGTH),
  version: z.number().int().min(0),
  tokenSet: z.boolean(),
  tokenLastFour: z.string().length(4).nullable(),
}).refine(value => (value.tokenSet ? value.tokenLastFour !== null : value.tokenLastFour === null))

export type InvoicingSettings = z.infer<typeof invoicingSettingsSchema>

/** No row yet. The first real change inserts one. */
export const EMPTY_INVOICING_SETTINGS: InvoicingSettings = {
  dueDays: INVOICING_DUE_DAYS_DEFAULT,
  vatRate: INVOICING_VAT_RATE_DEFAULT,
  lineText: INVOICING_LINE_TEXT_DEFAULT,
  version: 0,
  tokenSet: false,
  tokenLastFour: null,
}

export interface InvoicingSettingsSave {
  readonly dueDays: number
  readonly vatRate: InvoicingVatRate
  readonly lineText: string
  readonly version: number
  /** Set only when the Admin typed a new token. Blank leaves the stored one. */
  readonly token?: string
}

/** The body was not valid invoicing settings. Nothing is written. No value is in the message. */
export class InvoicingSettingsInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'InvoicingSettingsInputError'
  }
}

const invoicingSettingsSaveSchema = z.strictObject({
  dueDays: z.number().int().min(INVOICING_DUE_DAYS_MIN).max(INVOICING_DUE_DAYS_MAX),
  vatRate: invoicingVatRateSchema,
  lineText: z.string(),
  version: z.number().int().min(0),
  token: z.string().optional(),
})

/**
 * Accepts an invoicing-settings save. Any other body throws first, so the
 * caller does not open a session. A blank token is omitted. The line text
 * is trimmed. The token value is not copied into the error.
 */
export function parseInvoicingSettingsSave(raw: unknown): InvoicingSettingsSave {
  const parsed = invoicingSettingsSaveSchema.safeParse(raw)
  if (!parsed.success)
    throw new InvoicingSettingsInputError()
  const lineText = parsed.data.lineText.trim()
  if (lineText.length < 1 || lineText.length > INVOICING_LINE_TEXT_MAX_LENGTH)
    throw new InvoicingSettingsInputError()
  const token = parsed.data.token?.trim() ?? ''
  if (token !== '' && (token.length < INVOICING_TOKEN_MIN_LENGTH || token.length > INVOICING_TOKEN_MAX_LENGTH))
    throw new InvoicingSettingsInputError()
  return {
    dueDays: parsed.data.dueDays,
    vatRate: parsed.data.vatRate,
    lineText,
    version: parsed.data.version,
    ...(token === '' ? {} : { token }),
  }
}

/** Field names that differ, in canonical order. The token is a boolean, not a value. */
export function invoicingSettingsChangedFields(
  before: Pick<InvoicingSettings, 'dueDays' | 'vatRate' | 'lineText'>,
  after: Pick<InvoicingSettings, 'dueDays' | 'vatRate' | 'lineText'>,
  tokenChanged: boolean,
): InvoicingSettingsField[] {
  return INVOICING_SETTINGS_FIELDS.filter((field) => {
    if (field === 'token')
      return tokenChanged
    return before[field] !== after[field]
  })
}
