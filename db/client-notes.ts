import { sql } from 'drizzle-orm'
import { check, foreignKey, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { CLIENT_NOTE_MAX_LENGTH } from '../shared'
import { clients } from './clients'
import { tenantTable } from './tenant-table'

/**
 * The one standing Client note (ADR-0049). A child of `app.clients`:
 * the Client table itself does not change (ADR-0018). The composite foreign
 * key refuses another Tenant's Client. At most one row per Client.
 *
 * The text is trimmed, up to 2000 characters. Blank is null, not an empty
 * string: an empty save clears the text and keeps the row. There is no
 * DELETE grant. The version columns are the Client's (ADR-0046): version 0
 * has no author, and an office save records when and who. The first save
 * writes version 1 so a later refusal can name them. FORCE RLS and the
 * grants are in the migration; drizzle-kit cannot emit them.
 */

const noteMax = sql.raw(String(CLIENT_NOTE_MAX_LENGTH))

export const clientNotes = tenantTable('client_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  note: text('note'),
  // A constant default leaves a row that has never been saved at 0.
  // The application insert sets 1, with the member and the time.
  version: integer('version').notNull().default(0),
  dataChangedAt: timestamp('data_changed_at', { withTimezone: true, mode: 'date' }),
  // The member user id. Text, like audit actor ids. No foreign key.
  dataChangedBy: text('data_changed_by'),
}, table => [
  foreignKey({
    name: 'client_notes_client_fk',
    columns: [table.tenantId, table.clientId],
    foreignColumns: [clients.tenantId, clients.id],
  }),
  // One standing note. A second insert of the same Client cannot land.
  uniqueIndex('client_notes_one_per_client').on(table.tenantId, table.clientId),
  check(
    'client_notes_note',
    sql`${table.note} is null or (${table.note} = btrim(${table.note}) and length(${table.note}) between 1 and ${noteMax})`,
  ),
  check('client_notes_version', sql`${table.version} >= 0`),
  check('client_notes_data_change', sql`(${table.version} = 0 and ${table.dataChangedAt} is null and ${table.dataChangedBy} is null) or (${table.version} >= 1 and ${table.dataChangedAt} is not null and ${table.dataChangedBy} <> '')`),
], { oneRowPerTenant: false })
