import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { ContactPersonInputError, StaleSaveError } from '../../../../shared'
import { ClientNotFoundError } from './clients'
import { addContactPerson, ContactPersonNotFoundError, correctContactPerson, loadContactPersons, removeContactPerson } from './contact-persons'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const contactPersonId = '1d2c3b4a-6666-4666-8666-666666666666'
const dialect = new PgDialect()
const phone = '+385911110364'

interface Stored {
  id: string
  clientId: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
  version: number
  removedAt?: Date | null
  changedAt?: Date | null
  changedByName?: string | null
}

function fakeTransaction(options: { client?: boolean, row?: Stored | null, listed?: Stored[], claimed?: boolean } = {}) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (text.includes('from app.clients'))
        return { rows: options.client === false ? [] : [{ id: clientId }] }
      if (text.includes('insert into')) {
        return {
          rows: [{
            id: contactPersonId,
            clientId,
            name: compiled.params[1],
            role: compiled.params[2],
            phone: compiled.params[3],
            email: compiled.params[4],
            version: 0,
            changedAt: null,
            changedByName: null,
          }],
        }
      }
      if (text.includes('for update'))
        return { rows: options.row ? [options.row] : [] }
      if (text.includes('update'))
        return { rows: options.claimed === false ? [] : [{ id: contactPersonId }] }
      if (text.includes('client_contact_persons'))
        return { rows: options.listed ?? (options.row ? [options.row] : []) }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function auditParams(queries: Array<{ params: unknown[] }>, action: string): unknown {
  return queries.find(query => query.params[0] === action)?.params[3]
}

it('adds a contact person and records field names, not the name or the phone', async () => {
  const { transaction, queries } = fakeTransaction()
  await expect(addContactPerson(transaction, actorUserId, clientId, {
    name: 'Ana Booking',
    role: 'accounting',
    phone,
    email: null,
  })).resolves.toMatchObject({ id: contactPersonId, name: 'Ana Booking', version: 0, changedAt: null })
  expect(auditParams(queries, 'contact_person.added')).toBe(JSON.stringify({
    clientId,
    contactPersonId,
    fields: ['name', 'role', 'phone'],
  }))
  const audit = queries.find(query => query.params[0] === 'contact_person.added')
  expect(JSON.stringify(audit?.params)).not.toContain('Ana Booking')
  expect(JSON.stringify(audit?.params)).not.toContain(phone)
  expect(queries.some(query => query.sql.includes('update app.clients'))).toBe(false)
})

it('lists contact persons by name and leaves removed ones out of the read', async () => {
  const listed = [{
    id: contactPersonId,
    clientId,
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
    version: 0,
    changedAt: null,
    changedByName: null,
  }]
  const { transaction, queries } = fakeTransaction({ listed })
  await expect(loadContactPersons(transaction, clientId)).resolves.toEqual([{
    ...listed[0],
    changedAt: null,
  }])
  const list = queries.find(query => query.sql.includes('order by'))
  expect(list?.sql).toContain('removed_at is null')
  expect(list?.sql).toContain('order by')
  expect(list?.sql).toContain('app.tenant_member')
})

it('a missing Client is not found and nothing is inserted', async () => {
  const { transaction, queries } = fakeTransaction({ client: false })
  await expect(addContactPerson(transaction, actorUserId, clientId, {
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
  })).rejects.toBeInstanceOf(ClientNotFoundError)
  expect(queries.some(query => query.sql.includes('insert'))).toBe(false)
})

it('refuses a stale correction, including one that would change nothing, and writes nothing', async () => {
  const row: Stored = {
    id: contactPersonId,
    clientId,
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
    version: 2,
    removedAt: null,
    changedAt: null,
    changedByName: null,
  }
  const change = fakeTransaction({ row })
  await expect(correctContactPerson(change.transaction, actorUserId, clientId, contactPersonId, {
    name: 'Iva Accounts',
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(change.queries.some(query => query.sql.includes('update app.client_contact_persons'))).toBe(false)
  expect(auditParams(change.queries, 'contact_person.changed')).toBeUndefined()

  const same = fakeTransaction({ row })
  await expect(correctContactPerson(same.transaction, actorUserId, clientId, contactPersonId, {
    name: 'Ana Booking',
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(same.queries.some(query => query.sql.includes('update app.client_contact_persons'))).toBe(false)
})

it('writes nothing when a fresh correction matches the row', async () => {
  const row: Stored = {
    id: contactPersonId,
    clientId,
    name: 'Ana Booking',
    role: 'accounting',
    phone,
    email: null,
    version: 4,
    removedAt: null,
    changedAt: null,
    changedByName: null,
  }
  const { transaction, queries } = fakeTransaction({ row })
  await expect(correctContactPerson(transaction, actorUserId, clientId, contactPersonId, {
    phone,
    version: 4,
  })).resolves.toMatchObject({ id: contactPersonId, version: 4 })
  expect(queries.some(query => query.sql.includes('update app.client_contact_persons'))).toBe(false)
  expect(auditParams(queries, 'contact_person.changed')).toBeUndefined()
})

it('records a phone correction by the field name and bumps the version on that write', async () => {
  const row: Stored = {
    id: contactPersonId,
    clientId,
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
    version: 1,
    removedAt: null,
    changedAt: null,
    changedByName: null,
  }
  const nextPhone = '+385911110000'
  const { transaction, queries } = fakeTransaction({
    row,
    listed: [{ ...row, phone: nextPhone, version: 2, changedByName: 'Dino Dispatcher', changedAt: new Date('2026-10-20T08:00:00.000Z') }],
  })
  await expect(correctContactPerson(transaction, actorUserId, clientId, contactPersonId, {
    phone: nextPhone,
    version: 1,
  })).resolves.toMatchObject({ phone: nextPhone, version: 2, changedByName: 'Dino Dispatcher' })
  expect(auditParams(queries, 'contact_person.changed')).toBe(JSON.stringify({
    clientId,
    contactPersonId,
    fields: ['phone'],
  }))
  const write = queries.find(query => query.sql.includes('update app.client_contact_persons'))
  expect(write?.sql).toContain('version = version + 1')
  expect(write?.sql).toMatch(/and version = \$\d+/)
  expect(write?.params).toContain(1)
  expect(JSON.stringify(queries.find(query => query.params[0] === 'contact_person.changed')?.params)).not.toContain(nextPhone)
})

it('refuses a correction that would leave no phone and no email', async () => {
  const row: Stored = {
    id: contactPersonId,
    clientId,
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
    version: 0,
    removedAt: null,
    changedAt: null,
    changedByName: null,
  }
  const { transaction, queries } = fakeTransaction({ row })
  await expect(correctContactPerson(transaction, actorUserId, clientId, contactPersonId, {
    phone: null,
    version: 0,
  })).rejects.toBeInstanceOf(ContactPersonInputError)
  expect(queries.some(query => query.sql.includes('update app.client_contact_persons'))).toBe(false)
})

it('removes a contact person and records only that it was removed', async () => {
  const row: Stored = {
    id: contactPersonId,
    clientId,
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
    version: 0,
    removedAt: null,
    changedAt: null,
    changedByName: null,
  }
  const { transaction, queries } = fakeTransaction({ row })
  await expect(removeContactPerson(transaction, actorUserId, clientId, contactPersonId, 0)).resolves.toEqual({ id: contactPersonId })
  expect(auditParams(queries, 'contact_person.removed')).toBe(JSON.stringify({
    clientId,
    contactPersonId,
    fields: ['removed'],
  }))
  const audit = queries.find(query => query.params[0] === 'contact_person.removed')
  expect(JSON.stringify(audit?.params)).not.toContain('Ana Booking')
  const write = queries.find(query => query.sql.includes('removed_at = now()'))
  expect(write?.sql).toContain('version = version + 1')
})

it('a stale removal writes nothing, and a removed person at the current version is not found', async () => {
  const row: Stored = {
    id: contactPersonId,
    clientId,
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
    version: 3,
    removedAt: new Date('2026-10-20T08:00:00.000Z'),
    changedAt: new Date('2026-10-20T08:00:00.000Z'),
    changedByName: 'Dino Dispatcher',
  }
  const stale = fakeTransaction({ row })
  await expect(removeContactPerson(stale.transaction, actorUserId, clientId, contactPersonId, 2)).rejects.toBeInstanceOf(StaleSaveError)
  expect(stale.queries.some(query => query.sql.includes('removed_at = now()'))).toBe(false)

  const gone = fakeTransaction({ row })
  await expect(removeContactPerson(gone.transaction, actorUserId, clientId, contactPersonId, 3)).rejects.toBeInstanceOf(ContactPersonNotFoundError)
  expect(gone.queries.some(query => query.sql.includes('removed_at = now()'))).toBe(false)
})
