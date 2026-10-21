import type { ClientOfficeBrief } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { clientOfficeBriefSchema, clientOfficeContactSchema } from '../../../../shared'
import { TenantAccessError } from '../../tenancy'

function officeOnly(role: string): void {
  // Names, phones, emails, and the Client note are office facts. A driver
  // is refused here, not by the caller that already holds the transaction.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

const clientRows = z.object({
  rows: z.array(z.object({ clientId: z.uuid() })),
})

const contactRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    clientId: z.uuid(),
    name: z.string(),
    role: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  })),
})

const noteRows = z.object({
  rows: z.array(z.object({
    clientId: z.uuid(),
    note: z.string().nullable(),
  })),
})

/**
 * Live contact persons and the standing note for every Client in this Tenant.
 * A removed contact person is left out. An empty note, and a Client with no
 * note row, are null text. A driver is refused before any row is read.
 * The Driver's read must not call this (ADR-0049). Transfers reaches it
 * through the Clients index.
 */
export async function loadClientOfficeBriefs(transaction: TenantTransaction, role: string): Promise<ClientOfficeBrief[]> {
  officeOnly(role)
  const clients = clientRows.parse(await transaction.execute(sql`
    select id as "clientId"
    from app.clients
    order by name, id
  `))
  const contacts = contactRows.parse(await transaction.execute(sql`
    select id, client_id as "clientId", name, role, phone, email
    from app.client_contact_persons
    where removed_at is null
    order by name, id
  `))
  const notes = noteRows.parse(await transaction.execute(sql`
    select client_id as "clientId", note
    from app.client_notes
  `))
  const people = new Map<string, z.infer<typeof clientOfficeContactSchema>[]>()
  for (const row of contacts.rows) {
    const list = people.get(row.clientId) ?? []
    list.push(clientOfficeContactSchema.parse(row))
    people.set(row.clientId, list)
  }
  const noteByClient = new Map(notes.rows.map(row => [row.clientId, row.note]))
  return clients.rows.map(row => clientOfficeBriefSchema.parse({
    clientId: row.clientId,
    contactPersons: people.get(row.clientId) ?? [],
    // No row is the same empty note as a cleared row.
    note: noteByClient.get(row.clientId) ?? null,
  }))
}
