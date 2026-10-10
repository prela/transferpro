import type { AuditFact, Client, ClientPatch, CreateClient } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { clientKindSchema, clientNameSchema, clientSchema } from '../../../../shared'
import { appendAuditEntry } from '../../audit'

const clientRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    kind: clientKindSchema,
  })),
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
 * A patch that matches the locked row does not update and does not append.
 * A missing row is not found, including a row that belongs to another Tenant.
 */
export async function correctClient(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  patch: ClientPatch,
): Promise<Client> {
  const current = await lockClient(transaction, clientId)
  const next: Client = {
    id: current.id,
    name: patch.name === undefined ? current.name : clientNameSchema.parse(patch.name),
    kind: patch.kind === undefined ? current.kind : clientKindSchema.parse(patch.kind),
  }
  const facts = changedFacts(current, next)
  if (facts.length === 0)
    return current

  await transaction.execute(sql`
    update app.clients
    set name = ${next.name},
        kind = ${next.kind}
    where id = ${next.id}
  `)
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

async function lockClient(transaction: TenantTransaction, clientId: string): Promise<Client> {
  const selected = clientRows.parse(await transaction.execute(sql`
    select id, name, kind
    from app.clients
    where id = ${clientId}
    for update
  `))
  const row = selected.rows[0]
  if (!row)
    throw new ClientNotFoundError()
  return toClient(row)
}

function toClient(row: { id: string, name: string, kind: Client['kind'] }): Client {
  return clientSchema.parse(row)
}
