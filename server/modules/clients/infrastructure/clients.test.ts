import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { StaleSaveError } from '../../../../shared'
import { addClient, ClientNotFoundError, correctClient, loadClient, loadClientList, loadClients } from './clients'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const dialect = new PgDialect()

interface FakeRow {
  id: string
  name: string
  kind: 'agency' | 'hotel' | 'individual'
  version?: number
  changedAt?: Date | null
  changedByName?: string | null
}

/**
 * `claimed: false` is a concurrent save that bumped the version between the
 * lock and the write: the compare-and-swap update returns no row.
 */
function fakeTransaction(rows: FakeRow[], options: { claimed?: boolean } = {}) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (text.includes('insert')) {
        return {
          rows: [{
            id: clientId,
            name: compiled.params[0],
            kind: compiled.params[1],
          }],
        }
      }
      // `for update` contains the word update, so the lock is matched first.
      if (text.includes('for update')) {
        const id = compiled.params[0]
        return { rows: rows.filter(row => row.id === id).map(row => ({ version: 0, ...row })) }
      }
      if (text.includes('where id') && !text.includes('update')) {
        const id = compiled.params[0]
        return { rows: rows.filter(row => row.id === id) }
      }
      if (text.includes('update'))
        return { rows: options.claimed === false ? [] : [{ id: clientId }] }
      if (text.includes('clients'))
        return { rows }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function auditActions(queries: Array<{ params: unknown[] }>): unknown[] {
  return queries
    .map(query => query.params[0])
    .filter(param => typeof param === 'string' && param.startsWith('client.'))
}

function writes(queries: Array<{ sql: string, params: unknown[] }>) {
  return queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))
}

it('adds a Client and records the id and the kind, not the name', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(addClient(transaction, actorUserId, { name: 'Agencija Mora', kind: 'agency' })).resolves.toEqual({
    id: clientId,
    name: 'Agencija Mora',
    kind: 'agency',
  })
  const created = queries.find(query => query.params[0] === 'client.created')
  expect(created?.params[3]).toBe(JSON.stringify({ clientId, kind: 'agency' }))
  expect(JSON.stringify(created?.params)).not.toContain('Agencija Mora')
})

it('loads one Client by id, and a missing id is not found', async () => {
  const row = { id: clientId, name: 'Agencija Mora', kind: 'agency' as const }
  const { transaction } = fakeTransaction([row])
  await expect(loadClient(transaction, clientId)).resolves.toEqual(row)
  const missing = fakeTransaction([])
  await expect(loadClient(missing.transaction, clientId)).rejects.toBeInstanceOf(ClientNotFoundError)
})

it('lists the Clients the session returned', async () => {
  const { transaction } = fakeTransaction([
    { id: clientId, name: 'Agencija Mora', kind: 'agency' },
  ])
  await expect(loadClients(transaction)).resolves.toEqual([
    { id: clientId, name: 'Agencija Mora', kind: 'agency' },
  ])
})

it('lists the Clients for the edit form with the version and who last changed each one', async () => {
  const changedAt = new Date('2026-10-19T09:30:00.000Z')
  const { transaction, queries } = fakeTransaction([
    { id: clientId, name: 'Agencija Mora', kind: 'agency', version: 2, changedAt, changedByName: 'Dino Dispatcher' },
    { id: '1d2c3b4a-6666-4666-8666-666666666666', name: 'Hotel Park', kind: 'hotel', version: 0, changedAt: null, changedByName: null },
  ])
  await expect(loadClientList(transaction)).resolves.toEqual([
    { id: clientId, name: 'Agencija Mora', kind: 'agency', version: 2, changedAt: '2026-10-19T09:30:00.000Z', changedByName: 'Dino Dispatcher' },
    { id: '1d2c3b4a-6666-4666-8666-666666666666', name: 'Hotel Park', kind: 'hotel', version: 0, changedAt: null, changedByName: null },
  ])
  // The author is joined inside this Tenant only. Another Tenant's member never names a row.
  expect(queries[0]?.sql).toContain('app.tenant_member')
  expect(queries[0]?.sql).toContain('tenant_id')
})

it('records a name correction without the name, and a kind correction as from and to', async () => {
  const rows = [{ id: clientId, name: 'Agencija Mora', kind: 'agency' as const }]
  const { transaction, queries } = fakeTransaction(rows)
  await expect(correctClient(transaction, actorUserId, clientId, {
    name: 'Mora d.o.o.',
    kind: 'hotel',
    version: 0,
  })).resolves.toEqual({
    id: clientId,
    name: 'Mora d.o.o.',
    kind: 'hotel',
  })
  expect(auditActions(queries)).toEqual(['client.name_changed', 'client.kind_changed'])
  const renamed = queries.find(query => query.params[0] === 'client.name_changed')
  expect(renamed?.params[3]).toBe(JSON.stringify({ clientId }))
  expect(JSON.stringify(renamed?.params)).not.toContain('Mora')
  const kind = queries.find(query => query.params[0] === 'client.kind_changed')
  expect(kind?.params[3]).toBe(JSON.stringify({ clientId, from: 'agency', to: 'hotel' }))
})

it('a fresh correction bumps the version and records the member on the same write', async () => {
  const { transaction, queries } = fakeTransaction([{ id: clientId, name: 'Agencija Mora', kind: 'agency', version: 3 }])
  await correctClient(transaction, actorUserId, clientId, { name: 'Mora d.o.o.', version: 3 })
  const [write] = writes(queries)
  expect(write?.sql).toContain('version = version + 1')
  expect(write?.sql).toContain('data_changed_at = now()')
  expect(write?.params).toContain(actorUserId)
  // The opened version is the predicate of the write, so the check and the write are one statement.
  expect(write?.sql).toMatch(/and version = \$\d+/)
  expect(write?.params).toContain(3)
  expect(writes(queries)).toHaveLength(1)
})

it('refuses a stale correction, including one that would change nothing, and writes nothing', async () => {
  const stored = { id: clientId, name: 'Agencija Mora', kind: 'agency' as const, version: 2 }
  const change = fakeTransaction([stored])
  await expect(correctClient(change.transaction, actorUserId, clientId, { name: 'Mora d.o.o.', version: 1 }))
    .rejects
    .toBeInstanceOf(StaleSaveError)
  expect(writes(change.queries)).toEqual([])
  expect(auditActions(change.queries)).toEqual([])

  const same = fakeTransaction([stored])
  await expect(correctClient(same.transaction, actorUserId, clientId, { name: 'Agencija Mora', version: 1 }))
    .rejects
    .toBeInstanceOf(StaleSaveError)
  expect(writes(same.queries)).toEqual([])
  expect(auditActions(same.queries)).toEqual([])
})

it('a save that lost the version between the lock and the write is stale and appends nothing', async () => {
  const { transaction, queries } = fakeTransaction([{ id: clientId, name: 'Agencija Mora', kind: 'agency', version: 0 }], { claimed: false })
  await expect(correctClient(transaction, actorUserId, clientId, { kind: 'hotel', version: 0 }))
    .rejects
    .toBeInstanceOf(StaleSaveError)
  expect(auditActions(queries)).toEqual([])
})

it('writes nothing and keeps the version when a fresh correction matches the row', async () => {
  const { transaction, queries } = fakeTransaction([
    { id: clientId, name: 'Agencija Mora', kind: 'agency', version: 4 },
  ])
  await expect(correctClient(transaction, actorUserId, clientId, { name: 'Agencija Mora', version: 4 })).resolves.toEqual({
    id: clientId,
    name: 'Agencija Mora',
    kind: 'agency',
  })
  expect(writes(queries)).toEqual([])
  expect(auditActions(queries)).toEqual([])
})

it('does not find a Client the session cannot see', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(correctClient(transaction, actorUserId, clientId, { kind: 'hotel', version: 0 })).rejects.toBeInstanceOf(ClientNotFoundError)
  expect(auditActions(queries)).toEqual([])
})
