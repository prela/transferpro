import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { addClient, ClientNotFoundError, correctClient, loadClients } from './clients'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const dialect = new PgDialect()

function fakeTransaction(rows: Array<{ id: string, name: string, kind: 'agency' | 'hotel' | 'individual' }>) {
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
        return { rows: rows.filter(row => row.id === id) }
      }
      if (text.includes('update'))
        return { rows: [] }
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

it('lists the Clients the session returned', async () => {
  const { transaction } = fakeTransaction([
    { id: clientId, name: 'Agencija Mora', kind: 'agency' },
  ])
  await expect(loadClients(transaction)).resolves.toEqual([
    { id: clientId, name: 'Agencija Mora', kind: 'agency' },
  ])
})

it('records a name correction without the name, and a kind correction as from and to', async () => {
  const rows = [{ id: clientId, name: 'Agencija Mora', kind: 'agency' as const }]
  const { transaction, queries } = fakeTransaction(rows)
  await expect(correctClient(transaction, actorUserId, clientId, {
    name: 'Mora d.o.o.',
    kind: 'hotel',
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

it('writes nothing when the correction matches the row', async () => {
  const { transaction, queries } = fakeTransaction([
    { id: clientId, name: 'Agencija Mora', kind: 'agency' },
  ])
  await expect(correctClient(transaction, actorUserId, clientId, { name: 'Agencija Mora' })).resolves.toEqual({
    id: clientId,
    name: 'Agencija Mora',
    kind: 'agency',
  })
  expect(queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditActions(queries)).toEqual([])
})

it('does not find a Client the session cannot see', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(correctClient(transaction, actorUserId, clientId, { kind: 'hotel' })).rejects.toBeInstanceOf(ClientNotFoundError)
  expect(auditActions(queries)).toEqual([])
})
