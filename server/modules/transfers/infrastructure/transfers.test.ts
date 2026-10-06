import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { createLogger, handleLoggedError } from '../../../core/index'
import { ClientNotFoundError } from '../../clients'
import { LocationArchivedError } from '../../locations'
import { loadRidesForDay, recordTransfer } from './transfers'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const startLocationId = 'a1b2c3d4-5555-4555-8555-555555555555'
const endLocationId = 'b1b2c3d4-6666-4666-8666-666666666666'
const transferId = 'd1d1d1d1-1111-4111-8111-111111111111'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const guest = 'Ana Anić'
const flight = 'OU 384'
const note = 'Čeka na terminalu'
const dialect = new PgDialect()

const input = {
  clientId,
  pickupAt: '2026-10-06T22:30:00.000Z',
  startLocationId,
  endLocationId,
  passengerCount: 2,
  guestName: guest,
  flightNumber: flight,
  price: '42.50',
  payment: 'cash' as const,
  airportMark: false,
  luggageCount: 1,
  childSeatCount: 0,
  note,
}

interface FakeLocation {
  id: string
  name: string
  kind: 'airport' | 'hotel'
  address: string | null
  archivedAt: string | null
}

function fakeTransaction(options: {
  clients?: Array<{ id: string, name: string, kind: 'agency' }>
  locations?: FakeLocation[]
  dayRows?: unknown[]
  failInsert?: { message: string }
}) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (options.failInsert && text.includes('insert into app.transfers'))
        throw new Error(options.failInsert.message)
      if (text.includes('from app.clients'))
        return { rows: options.clients ?? [] }
      if (text.includes('from app.locations')) {
        const id = compiled.params[0]
        return { rows: (options.locations ?? []).filter(row => row.id === id) }
      }
      if (text.includes('insert into app.transfers')) {
        const params = compiled.params
        return {
          rows: [{
            id: transferId,
            clientId: params[0],
            pickupAt: params[1],
            startLocationId: params[2],
            endLocationId: params[3],
            passengerCount: params[4],
            guestName: params[5],
            flightNumber: params[6],
            price: params[7],
            payment: params[8],
            airportMark: params[9],
            luggageCount: params[10],
            childSeatCount: params[11],
            note: params[12],
          }],
        }
      }
      if (text.includes('insert into app.rides')) {
        return {
          rows: [{
            id: rideId,
            transferId: compiled.params[0],
            state: 'unassigned',
            driverId: null,
            vehicleId: null,
          }],
        }
      }
      if (text.includes('from app.rides'))
        return { rows: options.dayRows ?? [] }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

const places: FakeLocation[] = [
  { id: startLocationId, name: 'Zračna luka Dubrovnik', kind: 'airport', address: null, archivedAt: null },
  { id: endLocationId, name: 'Hotel Park', kind: 'hotel', address: null, archivedAt: null },
]

function auditPayloads(queries: Array<{ params: unknown[] }>): unknown[] {
  return queries
    .filter(query => query.params[0] === 'transfer.created')
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
  handleLoggedError(createLogger({ level: 'debug', destination }), error, 'req-transfer')
  return line
}

it('records one unassigned Ride and names fields, not the guest, the flight, the note, or the price', async () => {
  const { transaction, queries } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places,
  })
  await expect(recordTransfer(transaction, actorUserId, input)).resolves.toEqual({
    transfer: {
      id: transferId,
      clientId,
      pickupAt: '2026-10-06T22:30:00.000Z',
      startLocationId,
      endLocationId,
      passengerCount: 2,
      guestName: guest,
      flightNumber: flight,
      price: '42.50',
      payment: 'cash',
      airportMark: false,
      luggageCount: 1,
      childSeatCount: 0,
      note,
    },
    ride: {
      id: rideId,
      transferId,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
    },
  })
  const payload = auditPayloads(queries)
  expect(payload).toEqual([
    JSON.stringify({
      transferId,
      rideId,
      clientId,
      startLocationId,
      endLocationId,
      fields: ['pickupAt', 'passengerCount', 'guestName', 'flightNumber', 'price', 'payment', 'airportMark', 'luggageCount', 'childSeatCount', 'note'],
    }),
  ])
  const auditText = JSON.stringify(payload)
  expect(auditText).not.toContain(guest)
  expect(auditText).not.toContain(flight)
  expect(auditText).not.toContain(note)
  expect(auditText).not.toContain('42.50')
  expect(queries.filter(query => query.sql.includes('insert into app.rides'))).toHaveLength(1)
})

it('omits a blank flight and note from the field list', async () => {
  const { transaction, queries } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places,
  })
  await recordTransfer(transaction, actorUserId, { ...input, flightNumber: null, note: null })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({
      transferId,
      rideId,
      clientId,
      startLocationId,
      endLocationId,
      fields: ['pickupAt', 'passengerCount', 'guestName', 'price', 'payment', 'airportMark', 'luggageCount', 'childSeatCount'],
    }),
  ])
})

it('refuses an archived Location before any insert', async () => {
  const { transaction, queries } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places.map(place => place.id === startLocationId ? { ...place, archivedAt: '2026-10-05T10:00:00.000Z' } : place),
  })
  await expect(recordTransfer(transaction, actorUserId, input)).rejects.toBeInstanceOf(LocationArchivedError)
  expect(queries.some(query => query.sql.includes('insert into app.transfers'))).toBe(false)
})

it('refuses a Client that is not in this Tenant before any insert', async () => {
  const { transaction, queries } = fakeTransaction({ clients: [], locations: places })
  await expect(recordTransfer(transaction, actorUserId, input)).rejects.toBeInstanceOf(ClientNotFoundError)
  expect(queries.some(query => query.sql.includes('insert into app.transfers'))).toBe(false)
})

it('replaces a write failure so the log line does not keep the guest name', async () => {
  const { transaction } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places,
    failInsert: { message: `check violation ${guest} ${flight} ${note}` },
  })
  const error = await recordTransfer(transaction, actorUserId, input).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Transfer write failed' })
  expect(String(error)).not.toContain(guest)
  expect(logLine(error)).not.toContain(guest)
  expect(logLine(error)).not.toContain(flight)
  expect(logLine(error)).not.toContain(note)
})

it('asks Postgres for the pickup calendar day in the Tenant time zone', async () => {
  const pickup = new Date('2026-10-06T22:30:00.000Z')
  const { transaction, queries } = fakeTransaction({
    dayRows: [{
      rideId,
      transferId,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      clientId,
      pickupAt: pickup,
      startLocationId,
      endLocationId,
      passengerCount: 2,
      guestName: guest,
      flightNumber: null,
      price: '42.00',
      payment: 'card',
      airportMark: true,
      luggageCount: 0,
      childSeatCount: 0,
      note: null,
    }],
  })
  await expect(loadRidesForDay(transaction, '2026-10-07', 'Europe/Zagreb')).resolves.toMatchObject([
    { rideId, pickupAt: '2026-10-06T22:30:00.000Z', price: '42.00', airportMark: true },
  ])
  expect(queries[0]?.sql.toLowerCase()).toContain('at time zone')
  expect(queries[0]?.params).toEqual(['Europe/Zagreb', '2026-10-07'])
})
