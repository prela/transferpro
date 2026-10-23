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
            mainTransferId: params[15],
            groupPassengerCount: null,
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
            partnerId: null,
            mainTransferId: null,
            groupPassengerCount: null,
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
      mainTransferId: null,
      groupPassengerCount: 2,
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
      mainTransferId: null,
      groupPassengerCount: null,
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

it('keeps the Partner id on a handed-off Ride in the day list', async () => {
  // The office names the Partner from this id. The day read is the only
  // list the Ride detail and the crew column share. Null on every other state.
  const partnerId = 'c3c3c3c3-3333-4333-8333-333333333333'
  const pickup = new Date('2026-10-07T10:30:00.000Z')
  const { transaction, queries } = fakeTransaction({
    dayRows: [{
      rideId,
      transferId,
      state: 'handed_off',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
      partnerId,
      clientId,
      pickupAt: pickup,
      startLocationId,
      endLocationId,
      passengerCount: 2,
      guestName: guest,
      flightNumber: null,
      price: '42.00',
      payment: 'card',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
      note: null,
      tabla: '',
      clientReference: null,
    }],
  })
  await expect(loadRidesForDay(transaction, '2026-10-07', 'Europe/Zagreb')).resolves.toMatchObject([
    { rideId, state: 'handed_off', partnerId, driverId: null, vehicleId: null },
  ])
  expect(queries[0]?.sql).toContain('partner_id')
})

const markDriverId = 'c1c1c1c1-3333-4333-8333-333333333333'
const markVehicleId = 'f1f1f1f1-4444-4444-8444-444444444444'
const markPartnerId = 'c3c3c3c3-3333-4333-8333-333333333333'

function markDayRide(options: {
  id: string
  guestName: string
  state: 'assigned' | 'accepted' | 'done' | 'no-show' | 'cancelled' | 'unassigned' | 'handed_off'
  pickupAt: Date
  landingAt: Date | null
  mustAccept: boolean | null
  expectedArrival?: Date | null
  airportMark?: boolean
  transferId?: string
}) {
  const noCrew = options.state === 'unassigned' || options.state === 'handed_off'
  return {
    rideId: options.id,
    transferId: options.transferId ?? transferId,
    state: options.state,
    driverId: noCrew ? null : markDriverId,
    vehicleId: noCrew ? null : markVehicleId,
    mustAccept: options.mustAccept,
    partnerId: options.state === 'handed_off' ? markPartnerId : null,
    clientId,
    pickupAt: options.pickupAt,
    startLocationId,
    endLocationId,
    passengerCount: 1,
    guestName: options.guestName,
    flightNumber: null,
    price: '10.00',
    payment: 'cash' as const,
    airportMark: options.airportMark ?? false,
    luggageCount: 0,
    childSeatCount: 0,
    note: null,
    tabla: '',
    clientReference: null,
    landingAt: options.landingAt,
    expectedArrival: options.expectedArrival ?? null,
  }
}

function marksByGuest(rides: ReadonlyArray<{ guestName: string, unclosedMark: boolean }>) {
  return Object.fromEntries(rides.map(row => [row.guestName, row.unclosedMark]))
}

it('marks an in-progress Ride at the occupied end plus 60 minutes, including that instant', async () => {
  // 12:00 is pickup 10:00 plus duration 60 plus 60. One millisecond later on the basis is quiet.
  const now = new Date('2026-06-15T12:00:00.000Z')
  const atEnd = new Date('2026-06-15T10:00:00.000Z')
  const justShort = new Date('2026-06-15T10:00:00.001Z')
  const { transaction } = fakeTransaction({
    dayRows: [
      markDayRide({ id: rideId, guestName: 'At the mark', state: 'assigned', pickupAt: atEnd, landingAt: null, mustAccept: false }),
      markDayRide({ id: 'e2e2e2e2-2222-4222-8222-222222222222', guestName: 'Just short', state: 'accepted', pickupAt: justShort, landingAt: null, mustAccept: true }),
      markDayRide({ id: 'e3e3e3e3-2222-4222-8222-222222222222', guestName: 'Landed at the mark', state: 'assigned', pickupAt: new Date('2026-06-15T08:00:00.000Z'), landingAt: atEnd, mustAccept: false }),
      markDayRide({ id: 'e4e4e4e4-2222-4222-8222-222222222222', guestName: 'Landed just short', state: 'accepted', pickupAt: new Date('2026-06-15T08:00:00.000Z'), landingAt: justShort, mustAccept: true }),
      // Already past when the Ride is in progress, so the mark is on at once.
      markDayRide({ id: 'e5e5e5e5-2222-4222-8222-222222222222', guestName: 'Already past', state: 'assigned', pickupAt: new Date('2026-06-15T08:00:00.000Z'), landingAt: null, mustAccept: false }),
    ],
  })
  const rides = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 60)
  expect(marksByGuest(rides)).toEqual({
    'At the mark': true,
    'Just short': false,
    'Landed at the mark': true,
    'Landed just short': false,
    'Already past': true,
  })
  expect(rides.every(row => !('landingAlarm' in row))).toBe(true)
})

it('a late landing turns the mark off, and clearing the landing turns it back on', async () => {
  const now = new Date('2026-06-15T12:00:00.000Z')
  const pickupAt = new Date('2026-06-15T09:00:00.000Z')
  const { transaction } = fakeTransaction({
    dayRows: [
      markDayRide({ id: rideId, guestName: 'No landing', state: 'assigned', pickupAt, landingAt: null, mustAccept: false }),
      markDayRide({ id: 'e2e2e2e2-2222-4222-8222-222222222222', guestName: 'Late landing', state: 'assigned', pickupAt, landingAt: new Date('2026-06-15T11:30:00.000Z'), mustAccept: false }),
    ],
  })
  const rides = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 60)
  // No landing: end 10:00, mark 11:00. Late landing 11:30: end 12:30, mark 13:30.
  expect(marksByGuest(rides)).toEqual({
    'No landing': true,
    'Late landing': false,
  })
})

it('the expected arrival does not move the mark, and a duration change does', async () => {
  const now = new Date('2026-06-15T12:00:00.000Z')
  const pickupAt = new Date('2026-06-15T10:00:00.000Z')
  const { transaction } = fakeTransaction({
    dayRows: [
      markDayRide({
        id: rideId,
        guestName: 'Early estimate',
        state: 'assigned',
        pickupAt: new Date('2026-06-15T10:00:00.001Z'),
        landingAt: null,
        mustAccept: false,
        expectedArrival: new Date('2026-06-15T08:00:00.000Z'),
      }),
      markDayRide({
        id: 'e2e2e2e2-2222-4222-8222-222222222222',
        guestName: 'Late estimate',
        state: 'assigned',
        pickupAt,
        landingAt: null,
        mustAccept: false,
        expectedArrival: new Date('2026-06-15T12:00:00.000Z'),
        airportMark: true,
      }),
      markDayRide({
        id: 'e3e3e3e3-2222-4222-8222-222222222222',
        guestName: 'Landed',
        state: 'assigned',
        pickupAt: new Date('2026-06-15T08:00:00.000Z'),
        landingAt: pickupAt,
        mustAccept: false,
      }),
    ],
  })
  const rides = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 60)
  expect(marksByGuest(rides)).toEqual({
    // An estimate of 08:00 would already be marked if it were a landing.
    'Early estimate': false,
    // An estimate of 12:00 would still be quiet if it were a landing.
    'Late estimate': true,
    'Landed': true,
  })
  const longer = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 90)
  expect(longer.find(row => row.guestName === 'Landed')?.unclosedMark).toBe(false)
  expect(longer.find(row => row.guestName === 'Late estimate')?.unclosedMark).toBe(false)
})

it('changing the pickup moves the mark only while no landing is stored', async () => {
  const now = new Date('2026-06-15T12:00:00.000Z')
  const landingAt = new Date('2026-06-15T10:00:00.000Z')
  const { transaction } = fakeTransaction({
    dayRows: [
      markDayRide({ id: rideId, guestName: 'City at the mark', state: 'assigned', pickupAt: new Date('2026-06-15T10:00:00.000Z'), landingAt: null, mustAccept: false }),
      markDayRide({ id: 'e2e2e2e2-2222-4222-8222-222222222222', guestName: 'City just short', state: 'assigned', pickupAt: new Date('2026-06-15T10:00:00.001Z'), landingAt: null, mustAccept: false }),
      markDayRide({ id: 'e3e3e3e3-2222-4222-8222-222222222222', guestName: 'Landed early pickup', state: 'assigned', pickupAt: new Date('2026-06-15T08:00:00.000Z'), landingAt, mustAccept: false }),
      // Pickup 11:30 with no landing would be quiet. The landing keeps the mark.
      markDayRide({ id: 'e4e4e4e4-2222-4222-8222-222222222222', guestName: 'Landed late pickup', state: 'assigned', pickupAt: new Date('2026-06-15T11:30:00.000Z'), landingAt, mustAccept: false }),
    ],
  })
  const rides = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 60)
  expect(marksByGuest(rides)).toEqual({
    'City at the mark': true,
    'City just short': false,
    'Landed early pickup': true,
    'Landed late pickup': true,
  })
})

it('a handed-off Ride shares the instant, and a finished Ride does not take the mark', async () => {
  const now = new Date('2026-06-15T12:00:00.000Z')
  const atEnd = new Date('2026-06-15T10:00:00.000Z')
  const past = new Date('2026-06-15T08:00:00.000Z')
  const { transaction } = fakeTransaction({
    dayRows: [
      markDayRide({ id: rideId, guestName: 'Handed at the mark', state: 'handed_off', pickupAt: atEnd, landingAt: null, mustAccept: null }),
      markDayRide({ id: 'e2e2e2e2-2222-4222-8222-222222222222', guestName: 'Handed just short', state: 'handed_off', pickupAt: new Date('2026-06-15T10:00:00.001Z'), landingAt: null, mustAccept: null }),
      markDayRide({ id: 'e3e3e3e3-2222-4222-8222-222222222222', guestName: 'Handed landed', state: 'handed_off', pickupAt: new Date('2026-06-15T11:30:00.000Z'), landingAt: atEnd, mustAccept: null }),
      markDayRide({ id: 'e4e4e4e4-2222-4222-8222-222222222222', guestName: 'Waiting', state: 'assigned', pickupAt: past, landingAt: null, mustAccept: true }),
      markDayRide({ id: 'e5e5e5e5-2222-4222-8222-222222222222', guestName: 'Unassigned', state: 'unassigned', pickupAt: past, landingAt: null, mustAccept: null }),
      markDayRide({ id: 'e6e6e6e6-2222-4222-8222-222222222222', guestName: 'Done', state: 'done', pickupAt: past, landingAt: null, mustAccept: false }),
      markDayRide({ id: 'e7e7e7e7-2222-4222-8222-222222222222', guestName: 'No-show', state: 'no-show', pickupAt: past, landingAt: null, mustAccept: false }),
      markDayRide({ id: 'e8e8e8e8-2222-4222-8222-222222222222', guestName: 'Cancelled', state: 'cancelled', pickupAt: past, landingAt: null, mustAccept: false }),
    ],
  })
  const rides = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 60)
  expect(marksByGuest(rides)).toEqual({
    'Handed at the mark': true,
    'Handed just short': false,
    'Handed landed': true,
    'Waiting': false,
    'Unassigned': false,
    'Done': false,
    'No-show': false,
    'Cancelled': false,
  })
})

it('marks each member of a group from its own landing, and closing one leaves the other', async () => {
  // Each member is its own Transfer (ADR-0054). The day read has no group.
  const now = new Date('2026-06-15T12:00:00.000Z')
  const pickupAt = new Date('2026-06-15T08:00:00.000Z')
  const { transaction } = fakeTransaction({
    dayRows: [
      // Landing 09:00, duration 60: end 10:00, mark 11:00.
      markDayRide({ id: rideId, guestName: 'Early landing', state: 'assigned', pickupAt, landingAt: new Date('2026-06-15T09:00:00.000Z'), mustAccept: false, transferId: 'd2d2d2d2-1111-4111-8111-111111111111' }),
      // Landing 11:00: end 12:00, mark 13:00.
      markDayRide({ id: 'e2e2e2e2-2222-4222-8222-222222222222', guestName: 'Later landing', state: 'assigned', pickupAt, landingAt: new Date('2026-06-15T11:00:00.000Z'), mustAccept: false, transferId: 'd3d3d3d3-1111-4111-8111-111111111111' }),
      markDayRide({ id: 'e3e3e3e3-2222-4222-8222-222222222222', guestName: 'Closed early', state: 'done', pickupAt, landingAt: new Date('2026-06-15T09:00:00.000Z'), mustAccept: false, transferId: 'd4d4d4d4-1111-4111-8111-111111111111' }),
    ],
  })
  const rides = await loadRidesForDay(transaction, '2026-06-15', 'Europe/Zagreb', 5, now, 60)
  expect(marksByGuest(rides)).toEqual({
    'Early landing': true,
    'Later landing': false,
    'Closed early': false,
  })
})
