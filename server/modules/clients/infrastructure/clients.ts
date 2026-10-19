import type { AuditFact, Client, ClientListEntry, ClientPatch, CreateClient } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { clientKindSchema, clientListEntrySchema, clientNameSchema, clientSchema, StaleSaveError } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'

const clientRow = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: clientKindSchema,
})

const clientRows = z.object({
  rows: z.array(clientRow),
})

const lockedRows = z.object({
  rows: z.array(clientRow.extend({ version: z.number().int() })),
})

const listedRows = z.object({
  rows: z.array(clientRow.extend({
    version: z.number().int(),
    // pg returns a Date for timestamptz. Null stays null; an unreadable value fails the read.
    changedAt: z.coerce.date().nullable(),
    changedByName: z.string().min(1).nullable(),
  })),
})

const claimedRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/** The Client is not in this Tenant. Another Tenant's row looks the same. */
export class ClientNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'ClientNotFoundError'
  }
}

/** This Tenant's Clients, by name, so a Transfer can offer them. */
export async function loadClients(transaction: TenantTransaction): Promise<Client[]> {
  const selected = clientRows.parse(await transaction.execute(sql`
    select id, name, kind
    from app.clients
    order by name, id
  `))
  return selected.rows.map(toClient)
}

/**
 * This Tenant's Clients for the edit form: the version it opens with, and
 * when and by whom the last data change was made (ADR-0046). The name is
 * read from `app.tenant_member`, as the audit log reads it. A member who has
 * left has no row there, so the name is null and the time stays.
 */
export async function loadClientList(transaction: TenantTransaction): Promise<ClientListEntry[]> {
  const selected = listedRows.parse(await transaction.execute(sql`
    select c.id, c.name, c.kind, c.version,
           c.data_changed_at as "changedAt",
           changed_by.name as "changedByName"
    from app.clients as c
    -- The view is already this session's tenant. The tenant predicate keeps
    -- another tenant's name off the row if that filter is ever wider.
    left join app.tenant_member as changed_by
      on changed_by.user_id = c.data_changed_by
     and changed_by.tenant_id = c.tenant_id
    order by c.name, c.id
  `))
  return selected.rows.map(row => clientListEntrySchema.parse({
    ...row,
    changedAt: row.changedAt?.toISOString() ?? null,
  }))
}

/**
 * One Client in this Tenant, by id.
 * A missing id and another Tenant's id are the same result.
 * The Driver upcoming read calls this through the Clients index. It does
 * not apply the office role check: the caller already required a Driver.
 */
export async function loadClient(transaction: TenantTransaction, clientId: string): Promise<Client> {
  const selected = clientRows.parse(await transaction.execute(sql`
    select id, name, kind
    from app.clients
    where id = ${clientId}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new ClientNotFoundError()
  return toClient(row)
}

/**
 * Insert one Client and append `client.created` on this transaction.
 * The name is not in the entry (ADR-0017). The caller has already required
 * a dispatcher or an admin, and has already trimmed the name.
 */
export async function addClient(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreateClient,
): Promise<Client> {
  const selected = clientRows.parse(await transaction.execute(sql`
    insert into app.clients (name, kind)
    values (${input.name}, ${input.kind})
    returning id, name, kind
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Client insert returned no row.')
  const client = toClient(row)
  await appendAuditEntry(transaction, {
    action: 'client.created',
    actorUserId,
    subjectUserId: null,
    data: { clientId: client.id, kind: client.kind },
  })
  return client
}

/**
 * Correct the name, the kind, or both. One entry per field that changed.
 * A version other than the stored one is 409 `stale_save`, even when the
 * patch would change nothing; nothing is written or appended (ADR-0046).
 * A fresh patch that matches the locked row does not update, does not bump
 * the version, and does not append.
 * A missing row is not found, including a row that belongs to another Tenant.
 * A Client's version is its own: this never touches a Transfer's version.
 */
export async function correctClient(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  patch: ClientPatch,
): Promise<Client> {
  const locked = await lockClient(transaction, clientId)
  if (locked.version !== patch.version)
    throw new StaleSaveError()
  const current = toClient(locked)
  const next: Client = {
    id: current.id,
    name: patch.name === undefined ? current.name : clientNameSchema.parse(patch.name),
    kind: patch.kind === undefined ? current.kind : clientKindSchema.parse(patch.kind),
  }
  const facts = changedFacts(current, next)
  if (facts.length === 0)
    return current

  // The opened version is the predicate of the write itself, so the check
  // and the write are one atomic statement. The row lock above already makes
  // a concurrent save wait; zero rows here still means that save won.
  // The update binds the name and the member id. A failure must not carry them into the log.
  const claimed = claimedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.clients
    set name = ${next.name},
        kind = ${next.kind},
        version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where id = ${next.id}
      and version = ${patch.version}
    returning id
  `), 'Client correction failed'))
  if (!claimed.rows[0])
    throw new StaleSaveError()
  for (const fact of facts)
    await appendAuditEntry(transaction, { ...fact, actorUserId })
  return next
}

function changedFacts(current: Client, next: Client): AuditFact[] {
  const facts: AuditFact[] = []
  if (next.name !== current.name) {
    facts.push({
      action: 'client.name_changed',
      subjectUserId: null,
      data: { clientId: current.id },
    })
  }
  if (next.kind !== current.kind) {
    facts.push({
      action: 'client.kind_changed',
      subjectUserId: null,
      data: { clientId: current.id, from: current.kind, to: next.kind },
    })
  }
  return facts
}

/** The row and the version a concurrent save has already committed. */
async function lockClient(transaction: TenantTransaction, clientId: string) {
  const selected = lockedRows.parse(await transaction.execute(sql`
    select id, name, kind, version
    from app.clients
    where id = ${clientId}
    for update
  `))
  const row = selected.rows[0]
  if (!row)
    throw new ClientNotFoundError()
  return row
}

function toClient(row: { id: string, name: string, kind: Client['kind'] }): Client {
  return clientSchema.parse(row)
}
