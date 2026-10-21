import type { ClientNote, ClientNoteSave } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { CLIENT_NOTE_FIELD, clientNoteSchema, StaleSaveError } from '../../../../shared'
import { hideDatabaseError, postgresErrorCode } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { ClientNotFoundError } from './clients'

const noteRow = z.object({
  clientId: z.uuid(),
  note: z.string().nullable(),
  version: z.number().int(),
  changedAt: z.coerce.date().nullable(),
  changedByName: z.string().min(1).nullable(),
})

const noteRows = z.object({
  rows: z.array(noteRow),
})

const claimedRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

const clientRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/**
 * The Client has to be in this Tenant before the note is read or written.
 * A missing id and another Tenant's id are the same 404. This read does not
 * lock the Client and does not change its version (ADR-0049).
 */
async function requireClient(transaction: TenantTransaction, clientId: string): Promise<void> {
  const selected = clientRows.parse(await transaction.execute(sql`
    select id from app.clients where id = ${clientId}
  `))
  if (!selected.rows[0])
    throw new ClientNotFoundError()
}

function toNote(row: z.infer<typeof noteRow>): ClientNote {
  return clientNoteSchema.parse({
    ...row,
    changedAt: row.changedAt?.toISOString() ?? null,
  })
}

const noteSelect = sql`
  select n.client_id as "clientId", n.note, n.version,
         n.data_changed_at as "changedAt",
         changed_by.name as "changedByName"
  from app.client_notes as n
  -- The view is already this session's tenant. The tenant predicate keeps
  -- another tenant's name off the row if that filter is ever wider.
  left join app.tenant_member as changed_by
    on changed_by.user_id = n.data_changed_by
   and changed_by.tenant_id = n.tenant_id
`

/** No row yet. The first save sends no version. */
function emptyNote(clientId: string): ClientNote {
  return clientNoteSchema.parse({
    clientId,
    note: null,
    version: null,
    changedAt: null,
    changedByName: null,
  })
}

/**
 * This Client's standing note. No row is an empty note, not a missing Client.
 * The caller has already required a dispatcher or an admin.
 */
export async function loadClientNote(transaction: TenantTransaction, clientId: string): Promise<ClientNote> {
  await requireClient(transaction, clientId)
  const selected = noteRows.parse(await transaction.execute(sql`
    ${noteSelect}
    where n.client_id = ${clientId}
  `))
  const row = selected.rows[0]
  return row ? toNote(row) : emptyNote(clientId)
}

/** The row a concurrent save has already committed, locked for this transaction. */
async function lockClientNote(transaction: TenantTransaction, clientId: string) {
  const selected = noteRows.parse(await transaction.execute(sql`
    ${noteSelect}
    where n.client_id = ${clientId}
    for update of n
  `))
  return selected.rows[0] ?? null
}

/**
 * A second insert is already a stale save. Pass it through.
 * Any other failure is replaced, so a bound note never reaches a log.
 */
function isStaleSave(error: unknown): boolean {
  return error instanceof StaleSaveError
}

function recordNoteSaved(transaction: TenantTransaction, actorUserId: string, clientId: string) {
  return appendAuditEntry(transaction, {
    action: 'client_note.saved',
    actorUserId,
    subjectUserId: null,
    data: { clientId, fields: [CLIENT_NOTE_FIELD] },
  })
}

/**
 * Insert the one note for this Client. Version starts at 1 with the member
 * and the time, so a later refusal can say who saved it and when. A second
 * insert of the same Client is 409 `stale_save` and writes nothing.
 * The Client's version is not touched.
 */
async function insertClientNote(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  note: string | null,
): Promise<ClientNote> {
  const claimed = claimedRows.parse(await hideDatabaseError(async () => {
    try {
      return await transaction.execute(sql`
        insert into app.client_notes (client_id, note, version, data_changed_at, data_changed_by)
        values (${clientId}, ${note}, 1, now(), ${actorUserId})
        returning id
      `)
    }
    catch (error) {
      if (postgresErrorCode(error) === '23505')
        throw new StaleSaveError()
      throw error
    }
  }, 'Client note insert failed', { passthrough: isStaleSave }))
  if (!claimed.rows[0])
    throw new Error('Client note insert returned no row.')
  await recordNoteSaved(transaction, actorUserId, clientId)
  return loadClientNote(transaction, clientId)
}

/**
 * Save this Client's one note. The first save sends no version. A second
 * first save, including one that loses the race, is 409 `stale_save`.
 * A later save sends the version. A mismatch is 409 `stale_save` even when
 * the text would not change, and writes nothing. A fresh save of the same
 * text does not update and does not append. An empty first save is already
 * that empty note, so it writes nothing. An empty later save clears the
 * text and keeps the row. A note save does not change the Client's version.
 */
export async function saveClientNote(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  input: ClientNoteSave,
): Promise<ClientNote> {
  await requireClient(transaction, clientId)
  if (input.version === undefined) {
    // No row already reads as an empty note. Inserting a null row would
    // audit a change the card cannot see, and it would win the first-save race.
    if (input.note === null) {
      const current = await loadClientNote(transaction, clientId)
      if (current.version === null)
        return current
    }
    return insertClientNote(transaction, actorUserId, clientId, input.note)
  }

  const locked = await lockClientNote(transaction, clientId)
  // A version for a note that is not there is the same refusal as a mismatch.
  if (!locked || locked.version !== input.version)
    throw new StaleSaveError()
  const current = toNote(locked)
  if (current.note === input.note)
    return current

  const claimed = claimedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.client_notes
    set note = ${input.note},
        version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where client_id = ${clientId}
      and version = ${input.version}
    returning id
  `), 'Client note save failed'))
  if (!claimed.rows[0])
    throw new StaleSaveError()
  await recordNoteSaved(transaction, actorUserId, clientId)
  return loadClientNote(transaction, clientId)
}
