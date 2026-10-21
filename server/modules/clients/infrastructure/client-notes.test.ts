import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { StaleSaveError } from '../../../../shared'
import { loadClientNote, saveClientNote } from './client-notes'
import { ClientNotFoundError } from './clients'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const noteId = '1d2c3b4a-6666-4666-8666-666666666666'
const dialect = new PgDialect()
const note = 'Gosti se čekaju na izlazu.'
const savedAt = new Date('2026-10-21T08:00:00.000Z')

interface Stored {
  clientId: string
  note: string | null
  version: number
  changedAt: Date | null
  changedByName: string | null
}

function fakeTransaction(options: { client?: boolean, stored?: Stored | null, race?: boolean, claimed?: boolean } = {}) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  let stored = options.stored === undefined ? null : options.stored
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (text.includes('from app.clients'))
        return { rows: options.client === false ? [] : [{ id: clientId }] }
      if (text.includes('insert into app.client_notes')) {
        if (options.race)
          throw Object.assign(new Error('duplicate client note'), { code: '23505' })
        stored = {
          clientId,
          note: compiled.params[1] as string | null,
          version: 1,
          changedAt: savedAt,
          changedByName: 'Dino Dispatcher',
        }
        return { rows: [{ id: noteId }] }
      }
      if (text.includes('for update'))
        return { rows: stored ? [stored] : [] }
      if (text.includes('update app.client_notes')) {
        if (options.claimed === false || !stored)
          return { rows: [] }
        stored = {
          ...stored,
          note: compiled.params[0] as string | null,
          version: stored.version + 1,
          changedAt: savedAt,
          changedByName: 'Hana Admin',
        }
        return { rows: [{ id: noteId }] }
      }
      if (text.includes('from app.client_notes'))
        return { rows: stored ? [stored] : [] }
      return { rows: [] }
    }),
  }
  return { transaction, queries, read: () => stored }
}

function auditParams(queries: Array<{ params: unknown[] }>, action: string): unknown {
  return queries.find(query => query.params[0] === action)?.params[3]
}

it('saves the first note at version 1 and records the field name, not the text', async () => {
  const { transaction, queries } = fakeTransaction()
  await expect(saveClientNote(transaction, actorUserId, clientId, { note })).resolves.toEqual({
    clientId,
    note,
    version: 1,
    changedAt: '2026-10-21T08:00:00.000Z',
    changedByName: 'Dino Dispatcher',
  })
  expect(auditParams(queries, 'client_note.saved')).toBe(JSON.stringify({
    clientId,
    fields: ['note'],
  }))
  const audit = queries.find(query => query.params[0] === 'client_note.saved')
  expect(JSON.stringify(audit?.params)).not.toContain(note)
  expect(queries.some(query => query.sql.includes('update app.clients'))).toBe(false)
})

it('a first save of an empty note writes nothing and appends nothing', async () => {
  const { transaction, queries, read } = fakeTransaction()
  await expect(saveClientNote(transaction, actorUserId, clientId, { note: null })).resolves.toEqual({
    clientId,
    note: null,
    version: null,
    changedAt: null,
    changedByName: null,
  })
  expect(read()).toBeNull()
  expect(queries.some(query => query.sql.includes('insert into app.client_notes'))).toBe(false)
  expect(auditParams(queries, 'client_note.saved')).toBeUndefined()

  const missing = fakeTransaction({ client: false })
  await expect(saveClientNote(missing.transaction, actorUserId, clientId, { note: null })).rejects.toBeInstanceOf(ClientNotFoundError)
})

it('reads no row as an empty note, and a missing Client as not found', async () => {
  const empty = fakeTransaction()
  await expect(loadClientNote(empty.transaction, clientId)).resolves.toEqual({
    clientId,
    note: null,
    version: null,
    changedAt: null,
    changedByName: null,
  })
  const missing = fakeTransaction({ client: false })
  await expect(saveClientNote(missing.transaction, actorUserId, clientId, { note })).rejects.toBeInstanceOf(ClientNotFoundError)
  expect(missing.queries.some(query => query.sql.includes('insert'))).toBe(false)
})

it('a second first save that loses the race writes nothing and appends nothing', async () => {
  const { transaction, queries } = fakeTransaction({ race: true })
  await expect(saveClientNote(transaction, actorUserId, clientId, { note })).rejects.toBeInstanceOf(StaleSaveError)
  expect(auditParams(queries, 'client_note.saved')).toBeUndefined()
  expect(queries.some(query => query.sql.includes('update app.clients'))).toBe(false)
})

it('refuses a stale correction, including one that would change nothing, and writes nothing', async () => {
  const stored: Stored = {
    clientId,
    note,
    version: 2,
    changedAt: savedAt,
    changedByName: 'Dino Dispatcher',
  }
  const change = fakeTransaction({ stored })
  await expect(saveClientNote(change.transaction, actorUserId, clientId, {
    note: 'Plaćanje do 15.',
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(change.queries.some(query => query.sql.includes('update app.client_notes'))).toBe(false)
  expect(auditParams(change.queries, 'client_note.saved')).toBeUndefined()

  const same = fakeTransaction({ stored })
  await expect(saveClientNote(same.transaction, actorUserId, clientId, {
    note,
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(same.queries.some(query => query.sql.includes('update app.client_notes'))).toBe(false)
})

it('a version for a note that is not there is a stale save', async () => {
  const { transaction, queries } = fakeTransaction()
  await expect(saveClientNote(transaction, actorUserId, clientId, {
    note,
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(queries.some(query => query.sql.includes('update app.client_notes'))).toBe(false)
  expect(auditParams(queries, 'client_note.saved')).toBeUndefined()
})

it('writes nothing when a fresh save matches the stored text', async () => {
  const stored: Stored = {
    clientId,
    note,
    version: 4,
    changedAt: savedAt,
    changedByName: 'Dino Dispatcher',
  }
  const { transaction, queries } = fakeTransaction({ stored })
  await expect(saveClientNote(transaction, actorUserId, clientId, { note, version: 4 })).resolves.toEqual({
    clientId,
    note,
    version: 4,
    changedAt: '2026-10-21T08:00:00.000Z',
    changedByName: 'Dino Dispatcher',
  })
  expect(queries.some(query => query.sql.includes('update app.client_notes'))).toBe(false)
  expect(auditParams(queries, 'client_note.saved')).toBeUndefined()
})

it('corrects the text and records the field name, not the new text', async () => {
  const next = 'Plaćanje do 15. u mjesecu.'
  const stored: Stored = {
    clientId,
    note,
    version: 1,
    changedAt: savedAt,
    changedByName: 'Dino Dispatcher',
  }
  const { transaction, queries } = fakeTransaction({ stored })
  await expect(saveClientNote(transaction, actorUserId, clientId, { note: next, version: 1 })).resolves.toMatchObject({
    note: next,
    version: 2,
    changedByName: 'Hana Admin',
  })
  expect(auditParams(queries, 'client_note.saved')).toBe(JSON.stringify({ clientId, fields: ['note'] }))
  expect(JSON.stringify(queries.find(query => query.params[0] === 'client_note.saved')?.params)).not.toContain(next)
  expect(queries.some(query => query.sql.includes('update app.clients'))).toBe(false)
})

it('an empty save clears the text and keeps the row', async () => {
  const stored: Stored = {
    clientId,
    note,
    version: 1,
    changedAt: savedAt,
    changedByName: 'Dino Dispatcher',
  }
  const { transaction, queries, read } = fakeTransaction({ stored })
  await expect(saveClientNote(transaction, actorUserId, clientId, { note: null, version: 1 })).resolves.toMatchObject({
    note: null,
    version: 2,
  })
  expect(read()?.note).toBeNull()
  expect(queries.some(query => query.sql.includes('delete from'))).toBe(false)
  expect(auditParams(queries, 'client_note.saved')).toBe(JSON.stringify({ clientId, fields: ['note'] }))
})
