import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { createLogger, handleLoggedError } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
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
const tabla = 'GOSPOĐA HORVAT'
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
  tabla: '',
  clientReference: null,
}

interface FakeLocation {
  id: string
  name: string
  kind: 'airport' | 'hotel'
  address: string | null
  iata: string | null
  placeProvider: string | null
  placeRef: string | null
  archivedAt: string | null
}

function fakeTransaction(options: {
  clients?: Array<{ id: string, name: string, kind: 'agency' }>
  locations?: FakeLocation[]
  dayRows?: unknown[]
  failInsert?: { message: string }
  /** A manual Transfer already stored under the looked-up external id. */
  existing?: Record<string, unknown>[]
}) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      // The idempotent read. The insert also names external_id, and it has no WHERE.
      if (text.includes('external_id') && text.includes('where'))
        return { rows: options.existing ?? [] }
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
            tabla: params[13],
            clientReference: params[14],
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
            mustAccept: null,
          }],
        }
      }
      if (text.includes('from app.rides')) {
        return {
          rows: (options.dayRows ?? []).map(row => ({
            version: 0,
            changedAt: null,
            changedByName: null,
            ...(typeof row === 'object' && row !== null ? row : {}),
          })),
        }
      }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

const places: FakeLocation[] = [
  { id: startLocationId, name: 'Zračna luka Dubrovnik', kind: 'airport', address: null, iata: null, placeProvider: null, placeRef: null, archivedAt: null },
  { id: endLocationId, name: 'Hotel Park', kind: 'hotel', address: null, iata: null, placeProvider: null, placeRef: null, archivedAt: null },
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
  await expect(recordTransfer(transaction, actorUserId, input, crypto.randomUUID())).resolves.toEqual({
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
      tabla: '',
      clientReference: null,
    },
    ride: {
      id: rideId,
      transferId,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
    },
    alreadyRecorded: false,
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

it('returns the stored Transfer when the manual external id is already recorded and writes nothing', async () => {
  const externalId = 'f4f4f4f4-4444-4444-8444-444444444444'
  const logs = captureLogs()
  const { transaction, queries } = fakeTransaction({
    existing: [{
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
      tabla: '',
      clientReference: null,
      rideId,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
    }],
  })
  await expect(recordTransfer(transaction, actorUserId, { ...input, guestName: 'Netko Drugi' }, externalId, logs.logger)).resolves.toMatchObject({
    alreadyRecorded: true,
    transfer: { id: transferId, guestName: guest },
    ride: { id: rideId, state: 'unassigned' },
  })
  expect(queries.some(query => query.sql.includes('insert into app.transfers'))).toBe(false)
  expect(queries.some(query => query.params[0] === 'transfer.created')).toBe(false)
  const line = logs.lines()[0]
  expect(line).toMatchObject({ event: 'transfer.already_recorded', transferId })
  const text = JSON.stringify(line)
  expect(text).not.toContain(externalId)
  expect(text).not.toContain(guest)
  expect(text).not.toContain('Netko Drugi')
})

it('stores a tabla as its own fact, names the field, and keeps the words off the audit entry', async () => {
  const { transaction, queries } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places,
  })
  await expect(recordTransfer(transaction, actorUserId, { ...input, tabla }, crypto.randomUUID())).resolves.toMatchObject({
    transfer: { tabla, guestName: guest, note },
  })
  const payload = auditPayloads(queries)
  expect(payload).toEqual([
    JSON.stringify({
      transferId,
      rideId,
      clientId,
      startLocationId,
      endLocationId,
      fields: ['pickupAt', 'passengerCount', 'guestName', 'flightNumber', 'price', 'payment', 'airportMark', 'luggageCount', 'childSeatCount', 'note', 'tabla'],
    }),
  ])
  expect(JSON.stringify(payload)).not.toContain(tabla)
})

it('stores a Client reference, names the field, and keeps the number off the audit entry', async () => {
  const reference = 'V-19'
  const { transaction, queries } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places,
  })
  await expect(recordTransfer(transaction, actorUserId, { ...input, clientReference: reference }, crypto.randomUUID())).resolves.toMatchObject({
    transfer: { clientReference: reference },
  })
  const payload = auditPayloads(queries)
  expect(payload).toEqual([
    JSON.stringify({
      transferId,
      rideId,
      clientId,
      startLocationId,
      endLocationId,
      fields: ['pickupAt', 'passengerCount', 'guestName', 'flightNumber', 'price', 'payment', 'airportMark', 'luggageCount', 'childSeatCount', 'note', 'clientReference'],
    }),
  ])
  expect(JSON.stringify(payload)).not.toContain(reference)
})

it('omits a blank flight, note, and tabla from the field list', async () => {
  const { transaction, queries } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places,
  })
  await recordTransfer(transaction, actorUserId, { ...input, flightNumber: null, note: null }, crypto.randomUUID())
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
  await expect(recordTransfer(transaction, actorUserId, input, crypto.randomUUID())).rejects.toBeInstanceOf(LocationArchivedError)
  expect(queries.some(query => query.sql.includes('insert into app.transfers'))).toBe(false)
})

it('refuses a Client that is not in this Tenant before any insert', async () => {
  const { transaction, queries } = fakeTransaction({ clients: [], locations: places })
  await expect(recordTransfer(transaction, actorUserId, input, crypto.randomUUID())).rejects.toBeInstanceOf(ClientNotFoundError)
  expect(queries.some(query => query.sql.includes('insert into app.transfers'))).toBe(false)
})

it('replaces a write failure so the log line does not keep the guest name', async () => {
  const { transaction } = fakeTransaction({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
    locations: places,
    failInsert: { message: `check violation ${guest} ${flight} ${note} ${tabla}` },
  })
  const error = await recordTransfer(transaction, actorUserId, input, crypto.randomUUID()).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Transfer write failed' })
  expect(String(error)).not.toContain(guest)
  expect(logLine(error)).not.toContain(guest)
  expect(logLine(error)).not.toContain(flight)
  expect(logLine(error)).not.toContain(note)
  expect(logLine(error)).not.toContain(tabla)
})

it('loads the Zagreb operational day as a half-open range of local 05:00 and maps the ride', async () => {
  // 12:30 in Zagreb on 7 October, inside the operational day that starts at 05:00.
  const pickup = new Date('2026-10-07T10:30:00.000Z')
  const { transaction, queries } = fakeTransaction({
    dayRows: [{
      rideId,
      transferId,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
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
      tabla,
      clientReference: 'V-19',
    }],
  })
  await expect(loadRidesForDay(transaction, '2026-10-07', 'Europe/Zagreb')).resolves.toMatchObject([
    { rideId, pickupAt: '2026-10-07T10:30:00.000Z', price: '42.00', airportMark: true, tabla, guestName: guest, note: null, clientReference: 'V-19' },
  ])
  expect(queries[0]?.sql.toLowerCase()).not.toContain('::date')
  expect(queries[0]?.sql.toLowerCase()).not.toContain('at time zone')
  expect(queries[0]?.sql).toContain('changed_by.tenant_id')
  expect(queries[0]?.params).toEqual(['2026-10-07T03:00:00.000Z', '2026-10-08T03:00:00.000Z'])

  // 28 March contains the spring-forward; 24 October contains the fall-back. Both still end at local 05:00.
  await loadRidesForDay(transaction, '2026-03-28', 'Europe/Zagreb')
  await loadRidesForDay(transaction, '2026-10-24', 'Europe/Zagreb')
  expect(queries[1]?.params).toEqual(['2026-03-28T04:00:00.000Z', '2026-03-29T03:00:00.000Z'])
  expect(queries[2]?.params).toEqual(['2026-10-24T03:00:00.000Z', '2026-10-25T04:00:00.000Z'])
  expect(queries[1]?.sql.toLowerCase()).not.toContain('::date')
  expect(queries[2]?.sql.toLowerCase()).not.toContain('::date')
})

it('marks a landing alarm on an in-progress Ride 60 minutes after landing plus the transfer duration', async () => {
  const now = new Date('2026-06-15T10:00:00.000Z')
  const driverId = 'c1c1c1c1-3333-4333-8333-333333333333'
  const vehicleId = 'f1f1f1f1-4444-4444-8444-444444444444'
  function dayRide(id: string, guestName: string, state: 'assigned' | 'accepted' | 'done' | 'unassigned', landingAt: Date | null, mustAccept: boolean | null) {
    return {
      rideId: id,
      transferId,
      state,
      driverId: state === 'unassigned' ? null : driverId,
      vehicleId: state === 'unassigned' ? null : vehicleId,
      mustAccept,
      clientId,
      pickupAt: new Date('2026-06-15T08:00:00.000Z'),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName,
      flightNumber: null,
      price: '10.00',
      payment: 'cash' as const,
      airportMark: true,
      luggageCount: 0,
      childSeatCount: 0,
      note: null,
      tabla: '',
      clientReference: null,
      landingAt,
    }
  }
  const { transaction } = fakeTransaction({
    dayRows: [
      dayRide(rideId, 'Landed', 'assigned', new Date('2026-06-15T08:00:00.000Z'), false),
      dayRide('e2e2e2e2-2222-4222-8222-222222222222', 'Just short', 'accepted', new Date('2026-06-15T08:00:00.001Z'), true),
      dayRide('e3e3e3e3-2222-4222-8222-222222222222', 'No landing', 'assigned', null, false),
      dayRide('e4e4e4e4-2222-4222-8222-222222222222', 'Done', 'done', new Date('2026-06-15T07:00:00.000Z'), false),
      dayRide('e5e5e5e5-2222-4222-8222-222222222222', 'Waiting', 'assigned', new Date('2026-06-15T07:00:00.000Z'), true),
      dayRide('e6e6e6e6-2222-4222-8222-222222222222', 'Unassigned', 'unassigned', new Date('2026-06-15T07:00:00.000Z'), null),
    ],
  })
  const rides = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 60)
  expect(Object.fromEntries(rides.map(row => [row.guestName, row.landingAlarm]))).toEqual({
    'Landed': true,
    'Just short': false,
    'No landing': false,
    'Done': false,
    'Waiting': false,
    'Unassigned': false,
  })

  const longer = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 90)
  expect(longer.find(row => row.guestName === 'Landed')?.landingAlarm).toBe(false)
})
