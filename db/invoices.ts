import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, integer, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { clients } from './clients'
import { tenantTable } from './tenant-table'

/**
 * One invoice, owned by invoicing (ADR-0051). The Transfer reference is the
 * Transfer id and is opaque here: there is no foreign key to a Transfer.
 * The Client id is the buyer. A partial unique key allows one open invoice
 * per Transfer; cancelled and withdrawn are free so a later invoice can
 * exist. FORCE RLS and the grants are in the migration. There is no DELETE grant.
 *
 * The line may name a guest. That text stays on this row. An audit entry
 * stores the invoice id and the Transfer reference only.
 */

const states = sql.raw(`'requested', 'created', 'sent', 'failed', 'cancelling', 'cancelled', 'withdrawn'`)
const reasons = sql.raw(`'rejected', 'allowance', 'token', 'unavailable'`)
const languages = sql.raw(`'hr', 'en'`)

export const invoices = tenantTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  transferReference: uuid('transfer_reference').notNull(),
  state: text('state').notNull(),
  clientId: uuid('client_id').notNull(),
  lineText: text('line_text').notNull(),
  language: text('language').notNull(),
  dueDays: integer('due_days').notNull(),
  vatRate: integer('vat_rate').notNull(),
  grossAmount: numeric('gross_amount', { precision: 10, scale: 2 }).notNull(),
  quantity: integer('quantity').notNull().default(1),
  buyerType: text('buyer_type').notNull().default('b2b'),
  toolInvoiceId: text('tool_invoice_id'),
  invoiceNumber: text('invoice_number'),
  issuedOn: text('issued_on'),
  documentLink: text('document_link'),
  stornoNumber: text('storno_number'),
  stornoLink: text('storno_link'),
  reason: text('reason'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
  awaitingLookup: boolean('awaiting_lookup').notNull().default(false),
  /**
   * True once the storno job has committed its claim. The port is called
   * only after that commit, so a timeout cannot call the tool twice.
   * A constant default does not rewrite existing rows.
   */
  stornoCalled: boolean('storno_called').notNull().default(false),
  /**
   * True once the status job sees the negative invoice as sent.
   * Until then a cancelled invoice is an unsent warning (ADR-0051).
   * A constant default does not rewrite existing rows.
   */
  stornoSent: boolean('storno_sent').notNull().default(false),
  /**
   * When the status job last read this invoice in the current tool.
   * Null until the first read. The job takes the oldest, nulls first,
   * so a run of 20 rotates instead of rereading the same rows (ADR-0051).
   * No default and no backfill: existing rows stay unchecked.
   */
  statusCheckedAt: timestamp('status_checked_at', { withTimezone: true, mode: 'date' }),
  askedBy: text('asked_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: 'invoices_client_fk',
    columns: [table.tenantId, table.clientId],
    foreignColumns: [clients.tenantId, clients.id],
  }),
  // One invoice that is not cancelled or withdrawn, per Transfer, per Tenant.
  uniqueIndex('invoices_open_transfer').on(table.tenantId, table.transferReference).where(
    sql`${table.state} not in ('cancelled', 'withdrawn')`,
  ),
  check('invoices_state', sql`${table.state} in (${states})`),
  check('invoices_language', sql`${table.language} in (${languages})`),
  check('invoices_due_days', sql`${table.dueDays} between 0 and 365`),
  check('invoices_vat_rate', sql`${table.vatRate} in (0, 5, 13, 25)`),
  check('invoices_reason', sql`${table.reason} is null or ${table.reason} in (${reasons})`),
  check('invoices_attempt_count', sql`${table.attemptCount} between 0 and 4`),
  check('invoices_asked_by', sql`${table.askedBy} <> ''`),
  check('invoices_quantity', sql`${table.quantity} = 1`),
  check('invoices_buyer_type', sql`${table.buyerType} = 'b2b'`),
], { oneRowPerTenant: false })

/**
 * One create in flight per Tenant, and the instant the last create started.
 * The job uses this so two creates for one Tenant cannot overlap, and so
 * they stay ten seconds apart. Another Tenant has its own row.
 */
export const invoicingCreateGate = tenantTable('invoicing_create_gate', {
  inFlight: boolean('in_flight').notNull().default(false),
  lastCreateAt: timestamp('last_create_at', { withTimezone: true, mode: 'date' }),
})
