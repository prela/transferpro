import type { Buffer } from 'node:buffer'
import { sql } from 'drizzle-orm'
import { check, customType, integer, text } from 'drizzle-orm/pg-core'
import { INVOICING_DUE_DAYS_DEFAULT, INVOICING_LINE_TEXT_DEFAULT, INVOICING_VAT_RATE_DEFAULT } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One invoicing-settings row per Tenant (ADR-0051). The token is ciphertext,
 * a 96-bit nonce, and the last four characters. There is no plaintext token
 * column. FORCE RLS and the grants are in the migration. There is no DELETE grant.
 */

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

const dueMin = sql.raw('0')
const dueMax = sql.raw('365')
const lineMax = sql.raw('100')
const vatRates = sql.raw('0, 5, 13, 25')

export const invoicingSettings = tenantTable('invoicing_settings', {
  tokenCiphertext: bytea('token_ciphertext'),
  tokenNonce: bytea('token_nonce'),
  tokenLastFour: text('token_last_four'),
  dueDays: integer('due_days').notNull().default(INVOICING_DUE_DAYS_DEFAULT),
  vatRate: integer('vat_rate').notNull().default(INVOICING_VAT_RATE_DEFAULT),
  lineText: text('line_text').notNull().default(INVOICING_LINE_TEXT_DEFAULT),
  version: integer('version').notNull().default(0),
}, table => [
  check('invoicing_settings_due_days', sql`${table.dueDays} between ${dueMin} and ${dueMax}`),
  check('invoicing_settings_vat_rate', sql`${table.vatRate} in (${vatRates})`),
  check(
    'invoicing_settings_line_text',
    sql`${table.lineText} = btrim(${table.lineText}) and length(${table.lineText}) between 1 and ${lineMax}`,
  ),
  check('invoicing_settings_version', sql`${table.version} >= 0`),
  // All three token columns are empty until a token is set, or all three are present.
  // The nonce is 96 bits. The ciphertext includes the GCM tag, so it is longer than the tag alone.
  check(
    'invoicing_settings_token',
    sql`(${table.tokenCiphertext} is null and ${table.tokenNonce} is null and ${table.tokenLastFour} is null) or (${table.tokenCiphertext} is not null and ${table.tokenNonce} is not null and ${table.tokenLastFour} is not null and octet_length(${table.tokenNonce}) = 12 and octet_length(${table.tokenCiphertext}) > 16 and char_length(${table.tokenLastFour}) = 4)`,
  ),
])
