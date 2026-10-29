import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { BILLING_ADDRESS_MAX_LENGTH, BILLING_LEGAL_NAME_MAX_LENGTH, BILLING_OIB_COUNTRY, BILLING_VAT_ID_MAX_LENGTH, ISO_3166_1_ALPHA_2 } from '../shared'
import { clients } from './clients'
import { tenantTable } from './tenant-table'

/**
 * Billing details for one Client (ADR-0051). A child of `app.clients`:
 * the Client table itself does not change. The composite foreign key
 * refuses another Tenant's Client. At most one row per Client.
 *
 * The legal name, the country, and the address are required. The OIB is
 * required when the country is Croatia, and it has to pass ISO 7064.
 * The check calls `app.oib_is_valid`, which the migration creates; drizzle-kit
 * cannot emit that function. The VAT id is optional. The guest-name checkbox
 * starts off. The version columns are the Client note's (ADR-0046): version 0
 * has no author, and an office save records when and who. FORCE RLS and the
 * grants are in the migration.
 */

const legalNameMax = sql.raw(String(BILLING_LEGAL_NAME_MAX_LENGTH))
const addressMax = sql.raw(String(BILLING_ADDRESS_MAX_LENGTH))
const vatMax = sql.raw(String(BILLING_VAT_ID_MAX_LENGTH))
const croatia = sql.raw(`'${BILLING_OIB_COUNTRY}'`)
const countries = sql.raw(ISO_3166_1_ALPHA_2.map(code => `'${code}'`).join(', '))

export const clientBillingDetails = tenantTable('client_billing_details', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  legalName: text('legal_name').notNull(),
  country: text('country').notNull(),
  oib: text('oib'),
  vatId: text('vat_id'),
  address: text('address').notNull(),
  // Off until the office asks for the guest name on the invoice.
  guestNameOnInvoice: boolean('guest_name_on_invoice').notNull().default(false),
  // A constant default leaves a row that has never been saved at 0.
  // The application insert sets 1, with the member and the time.
  version: integer('version').notNull().default(0),
  dataChangedAt: timestamp('data_changed_at', { withTimezone: true, mode: 'date' }),
  // The member user id. Text, like audit actor ids. No foreign key.
  dataChangedBy: text('data_changed_by'),
}, table => [
  foreignKey({
    name: 'client_billing_details_client_fk',
    columns: [table.tenantId, table.clientId],
    foreignColumns: [clients.tenantId, clients.id],
  }),
  // One billing row. A second insert of the same Client cannot land.
  uniqueIndex('client_billing_details_one_per_client').on(table.tenantId, table.clientId),
  check(
    'client_billing_details_legal_name',
    sql`${table.legalName} = btrim(${table.legalName}) and length(${table.legalName}) between 1 and ${legalNameMax}`,
  ),
  check(
    'client_billing_details_country',
    sql`${table.country} in (${countries})`,
  ),
  check(
    'client_billing_details_oib',
    sql`(${table.country} <> ${croatia} or ${table.oib} is not null) and (${table.oib} is null or app.oib_is_valid(${table.oib}))`,
  ),
  check(
    'client_billing_details_vat_id',
    sql`${table.vatId} is null or (${table.vatId} = btrim(${table.vatId}) and length(${table.vatId}) between 1 and ${vatMax})`,
  ),
  check(
    'client_billing_details_address',
    sql`${table.address} = btrim(${table.address}) and length(${table.address}) between 1 and ${addressMax}`,
  ),
  check('client_billing_details_version', sql`${table.version} >= 0`),
  // Version 0 has no recorded change. A later version names when and who.
  // `<> ''` is unknown when the member is null, and a CHECK accepts unknown,
  // so the member must also be present. Otherwise version >= 1 with no member passes.
  check('client_billing_details_data_change', sql`(${table.version} = 0 and ${table.dataChangedAt} is null and ${table.dataChangedBy} is null) or (${table.version} >= 1 and ${table.dataChangedAt} is not null and ${table.dataChangedBy} is not null and ${table.dataChangedBy} <> '')`),
], { oneRowPerTenant: false })
