import type { ContactPerson, ContactPersonField, ContactPersonPatch, ContactPersonWrite } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { addedContactPersonFields, ContactPersonInputError, contactPersonSchema, StaleSaveError } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { ClientNotFoundError } from './clients'

const contactRow = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  name: z.string(),
  role: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  version: z.number().int(),
  changedAt: z.coerce.date().nullable(),
  changedByName: z.string().min(1).nullable(),
})

const contactRows = z.object({
  rows: z.array(contactRow),
})

const lockedRow = contactRow.extend({
  removedAt: z.coerce.date().nullable(),
})

const lockedRows = z.object({
  rows: z.array(lockedRow),
})

const claimedRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

const clientRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/** The contact person is not on this Client. Another Tenant's row looks the same. */
export class ContactPersonNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'ContactPersonNotFoundError'
  }
}

/**
 * The Client has to be in this Tenant before a contact is read or written.
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

function toContact(row: z.infer<typeof contactRow>): ContactPerson {
  return contactPersonSchema.parse({
    ...row,
    changedAt: row.changedAt?.toISOString() ?? null,
  })
}

const contactSelect = sql`
  select p.id, p.client_id as "clientId", p.name, p.role, p.phone, p.email, p.version,
         p.data_changed_at as "changedAt",
         changed_by.name as "changedByName"
  from app.client_contact_persons as p
  -- The view is already this session's tenant. The tenant predicate keeps
  -- another tenant's name off the row if that filter is ever wider.
  left join app.tenant_member as changed_by
    on changed_by.user_id = p.data_changed_by
   and changed_by.tenant_id = p.tenant_id
`

/**
 * This Client's contact persons, by name. A removed person is left out.
 * The caller has already required a dispatcher or an admin.
 */
export async function loadContactPersons(transaction: TenantTransaction, clientId: string): Promise<ContactPerson[]> {
  await requireClient(transaction, clientId)
  const selected = contactRows.parse(await transaction.execute(sql`
    ${contactSelect}
    where p.client_id = ${clientId}
      and p.removed_at is null
    order by p.name, p.id
  `))
  return selected.rows.map(toContact)
}

/**
 * Insert one contact person and append `contact_person.added`.
 * The name, the role, the phone, and the email stay off the audit row.
 * The Client's version is not touched.
 */
export async function addContactPerson(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  input: ContactPersonWrite,
): Promise<ContactPerson> {
  await requireClient(transaction, clientId)
  const selected = contactRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    insert into app.client_contact_persons (client_id, name, role, phone, email)
    values (${clientId}, ${input.name}, ${input.role}, ${input.phone}, ${input.email})
    returning id, client_id as "clientId", name, role, phone, email, version,
              data_changed_at as "changedAt",
              null::text as "changedByName"
  `), 'Contact person insert failed'))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Contact person insert returned no row.')
  await appendAuditEntry(transaction, {
    action: 'contact_person.added',
    actorUserId,
    subjectUserId: null,
    data: {
      clientId,
      contactPersonId: row.id,
      fields: addedContactPersonFields(input),
    },
  })
  return toContact(row)
}

/** The row a concurrent save has already committed, including a removed one. */
async function lockContactPerson(transaction: TenantTransaction, clientId: string, contactPersonId: string) {
  const selected = lockedRows.parse(await transaction.execute(sql`
    select p.id, p.client_id as "clientId", p.name, p.role, p.phone, p.email, p.version,
           p.removed_at as "removedAt",
           p.data_changed_at as "changedAt",
           changed_by.name as "changedByName"
    from app.client_contact_persons as p
    left join app.tenant_member as changed_by
      on changed_by.user_id = p.data_changed_by
     and changed_by.tenant_id = p.tenant_id
    where p.id = ${contactPersonId}
      and p.client_id = ${clientId}
    for update of p
  `))
  const row = selected.rows[0]
  if (!row)
    throw new ContactPersonNotFoundError()
  return row
}

function changedFields(current: ContactPersonWrite, next: ContactPersonWrite): ContactPersonField[] {
  const fields: ContactPersonField[] = []
  if (next.name !== current.name)
    fields.push('name')
  if (next.role !== current.role)
    fields.push('role')
  if (next.phone !== current.phone)
    fields.push('phone')
  if (next.email !== current.email)
    fields.push('email')
  return fields
}

/**
 * Correct a contact person. A version other than the stored one is
 * 409 `stale_save`, even when the patch would change nothing and even
 * when the person has since been removed. Nothing is written or appended.
 * A fresh patch that matches the row does not update and does not append.
 * A contact save does not change the Client's version.
 */
export async function correctContactPerson(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  contactPersonId: string,
  patch: ContactPersonPatch,
): Promise<ContactPerson> {
  await requireClient(transaction, clientId)
  const locked = await lockContactPerson(transaction, clientId, contactPersonId)
  if (locked.version !== patch.version)
    throw new StaleSaveError()
  if (locked.removedAt !== null)
    throw new ContactPersonNotFoundError()
  const current = toContact(locked)
  const next: ContactPersonWrite = {
    name: patch.name === undefined ? current.name : patch.name,
    role: patch.role === undefined ? current.role : patch.role,
    phone: patch.phone === undefined ? current.phone : patch.phone,
    email: patch.email === undefined ? current.email : patch.email,
  }
  // Clearing the last way to reach this person is a bad body, not a save.
  if (next.phone === null && next.email === null)
    throw new ContactPersonInputError()
  const fields = changedFields(current, next)
  if (fields.length === 0)
    return current

  const claimed = claimedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.client_contact_persons
    set name = ${next.name},
        role = ${next.role},
        phone = ${next.phone},
        email = ${next.email},
        version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where id = ${contactPersonId}
      and client_id = ${clientId}
      and version = ${patch.version}
      and removed_at is null
    returning id
  `), 'Contact person correction failed'))
  if (!claimed.rows[0])
    throw new StaleSaveError()
  await appendAuditEntry(transaction, {
    action: 'contact_person.changed',
    actorUserId,
    subjectUserId: null,
    data: { clientId, contactPersonId, fields },
  })
  const reread = await loadContactPersons(transaction, clientId)
  const saved = reread.find(person => person.id === contactPersonId)
  if (!saved)
    throw new ContactPersonNotFoundError()
  return saved
}

/**
 * Mark a contact person removed. It leaves the list at once. The version
 * still has to match, including when a colleague already removed it.
 * A second remove of the current version is not found: the person is gone.
 */
export async function removeContactPerson(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  contactPersonId: string,
  version: number,
): Promise<{ id: string }> {
  await requireClient(transaction, clientId)
  const locked = await lockContactPerson(transaction, clientId, contactPersonId)
  if (locked.version !== version)
    throw new StaleSaveError()
  if (locked.removedAt !== null)
    throw new ContactPersonNotFoundError()
  const claimed = claimedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.client_contact_persons
    set removed_at = now(),
        version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where id = ${contactPersonId}
      and client_id = ${clientId}
      and version = ${version}
      and removed_at is null
    returning id
  `), 'Contact person removal failed'))
  if (!claimed.rows[0])
    throw new StaleSaveError()
  await appendAuditEntry(transaction, {
    action: 'contact_person.removed',
    actorUserId,
    subjectUserId: null,
    data: { clientId, contactPersonId, fields: ['removed'] },
  })
  return { id: contactPersonId }
}

const deletedRows = z.object({ rowCount: z.number().int().nonnegative() })

/**
 * Delete this Tenant's contact persons removed before `before` (ADR-0049).
 * A live person has no removal instant, so the comparison leaves them.
 * The restrictive policy refuses any newer removal even if asked. The
 * caller's transaction already holds the tenant session. Answers the count only.
 */
export async function deleteContactPersonsRemovedBefore(transaction: TenantTransaction, before: Date): Promise<number> {
  const cutoff = z.date().parse(before)
  const deleted = deletedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    delete from app.client_contact_persons where removed_at < ${cutoff}
  `), 'Contact person retention delete failed'))
  return deleted.rowCount
}
