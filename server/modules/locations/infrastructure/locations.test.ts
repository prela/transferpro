import type { SQL } from 'drizzle-orm'
import type { Location } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { createLogger, handleLoggedError } from '../../../core/index'
import { addLocation, archiveStoredLocation, correctLocation, loadLocation, loadLocations, LocationArchivedError, LocationNotFoundError } from './locations'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const locationId = 'a1b2c3d4-5555-4555-8555-555555555555'
const name = 'Zračna luka Dubrovnik'
const address = 'Dobrota bb, Čilipi'
const dialect = new PgDialect()

const stored: Location = {
  id: locationId,
  name,
  kind: 'airport',
  address: null,
  archivedAt: null,
}

function fakeTransaction(
  locations: Location[],
  fail?: { code: string, message: string },
) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (fail && (text.includes('insert') || (text.includes('update') && !text.includes('for update'))))
        throw Object.assign(new Error(fail.message), { code: fail.code, cause: new Error(fail.message) })
      if (text.includes('insert into app.locations')) {
        return {
          rows: [{
            id: locationId,
            name: compiled.params[0],
            kind: compiled.params[1],
            address: compiled.params[2] ?? null,
            archivedAt: null,
          }],
        }
      }
      if (text.includes('for update') || (text.includes('select') && text.includes('where id'))) {
        const id = compiled.params[0]
        return { rows: locations.filter(row => row.id === id) }
      }
      if (text.includes('set archived_at')) {
        const archived = { ...locations[0]!, archivedAt: new Date('2026-10-05T10:00:00.000Z') }
        return { rows: [archived] }
      }
      if (text.includes('update'))
        return { rows: [] }
      if (text.includes('from app.locations'))
        return { rows: locations }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function auditPayloads(queries: Array<{ params: unknown[] }>): unknown[] {
  return queries
    .filter(query => typeof query.params[0] === 'string' && String(query.params[0]).startsWith('location.'))
    .map(query => query.params[3])
}

function logLine(error: unknown): string {
  let line = ''
  const destination: Writable = new Writable({
    write(chunk, _encoding, callback) {
      line += String(chunk)
      callback()
    },
  })
  handleLoggedError(createLogger({ level: 'debug', destination }), error, 'req-location')
  return line
}

const input = {
  name,
  kind: 'airport' as const,
  address: null,
}

it('adds a Location and records field names, not the name or the address', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(addLocation(transaction, actorUserId, { ...input, address })).resolves.toMatchObject({
    id: locationId,
    name,
    kind: 'airport',
    address,
    archivedAt: null,
  })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({
      locationId,
      fields: ['name', 'kind', 'address'],
    }),
  ])
  expect(JSON.stringify(auditPayloads(queries))).not.toContain(name)
  expect(JSON.stringify(auditPayloads(queries))).not.toContain(address)
})

it('omits address from the created fields when the line is blank', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(addLocation(transaction, actorUserId, input)).resolves.toMatchObject({ address: null })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ locationId, fields: ['name', 'kind'] }),
  ])
})

it('replaces a write failure so the log line does not keep the address', async () => {
  const { transaction } = fakeTransaction([], {
    code: '23514',
    message: `check violation ${address}`,
  })
  const error = await addLocation(transaction, actorUserId, { ...input, address }).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Location write failed' })
  expect(String(error)).not.toContain(address)
  expect(String(error)).not.toContain(name)
  expect(logLine(error)).not.toContain(address)
})

it('lists the Locations the session returned, and the default list asks to hide archived rows', async () => {
  const live = fakeTransaction([stored])
  await expect(loadLocations(live.transaction, false)).resolves.toEqual([stored])
  expect(live.queries[0]?.sql).toContain('archived_at is null')

  const archived = { ...stored, archivedAt: '2026-10-05T10:00:00.000Z' }
  const all = fakeTransaction([stored, archived])
  await expect(loadLocations(all.transaction, true)).resolves.toEqual([stored, archived])
  expect(all.queries[0]?.sql).not.toContain('archived_at is null')
})

it('loads an archived Location by id, and a missing id is not found', async () => {
  const archived = { ...stored, archivedAt: '2026-10-05T10:00:00.000Z' }
  const { transaction } = fakeTransaction([archived])
  await expect(loadLocation(transaction, locationId)).resolves.toEqual(archived)
  const missing = fakeTransaction([])
  await expect(loadLocation(missing.transaction, locationId)).rejects.toBeInstanceOf(LocationNotFoundError)
})

it('records each corrected field by name, and not the name or the address', async () => {
  const nextName = 'Hotel Excelsior'
  const nextAddress = 'Frana Supila 12'
  const { transaction, queries } = fakeTransaction([stored])
  await expect(correctLocation(transaction, actorUserId, locationId, {
    name: nextName,
    kind: 'hotel',
    address: nextAddress,
  })).resolves.toMatchObject({
    name: nextName,
    kind: 'hotel',
    address: nextAddress,
  })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ locationId, field: 'name' }),
    JSON.stringify({ locationId, field: 'kind' }),
    JSON.stringify({ locationId, field: 'address' }),
  ])
  const text = JSON.stringify(auditPayloads(queries))
  expect(text).not.toContain(name)
  expect(text).not.toContain(nextName)
  expect(text).not.toContain(nextAddress)
})

it('writes nothing when the correction matches the row', async () => {
  const { transaction, queries } = fakeTransaction([{ ...stored, address }])
  await expect(correctLocation(transaction, actorUserId, locationId, { name, address })).resolves.toMatchObject({ address })
  expect(queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(queries)).toEqual([])
})

it('records clearing an address by field name, not the text', async () => {
  const { transaction, queries } = fakeTransaction([{ ...stored, address }])
  await expect(correctLocation(transaction, actorUserId, locationId, { address: null })).resolves.toMatchObject({
    address: null,
  })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ locationId, field: 'address' }),
  ])
  expect(JSON.stringify(auditPayloads(queries))).not.toContain(address)
})

it('archives a Location without storing the name, and a second archive writes nothing', async () => {
  const { transaction, queries } = fakeTransaction([stored])
  const archived = await archiveStoredLocation(transaction, actorUserId, locationId)
  expect(archived.archivedAt).toBe('2026-10-05T10:00:00.000Z')
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ locationId }),
  ])
  expect(JSON.stringify(auditPayloads(queries))).not.toContain(name)

  const already = fakeTransaction([{ ...stored, archivedAt: '2026-10-05T10:00:00.000Z' }])
  await expect(archiveStoredLocation(already.transaction, actorUserId, locationId)).resolves.toMatchObject({
    archivedAt: '2026-10-05T10:00:00.000Z',
  })
  expect(already.queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(already.queries)).toEqual([])
})

it('does not find a Location the session cannot see', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(correctLocation(transaction, actorUserId, locationId, { kind: 'hotel' })).rejects.toBeInstanceOf(LocationNotFoundError)
  expect(auditPayloads(queries)).toEqual([])
})

it('refuses a correction of an archived Location and writes nothing', async () => {
  const archived = { ...stored, archivedAt: '2026-10-05T10:00:00.000Z' }
  const { transaction, queries } = fakeTransaction([archived])
  await expect(correctLocation(transaction, actorUserId, locationId, { kind: 'hotel' })).rejects.toBeInstanceOf(LocationArchivedError)
  expect(queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(queries)).toEqual([])
})
