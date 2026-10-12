import type { SQL } from 'drizzle-orm'
import type { RideState } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { ArrivalMovedNotice, Mailer } from '../../tenancy'
import type { FlightStatusPort } from './flight-landing'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { FLIGHT_ASK_EVERY_MINUTES } from '../../../../shared'
import { createLogger } from '../../../core/index'
import { askFlightLandings, LandingTimeClosedError, LandingTimeInFutureError, recordLandingTime, refreshFlightLandings } from './flight-landing'

const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const transferId = 'd1d1d1d1-1111-4111-8111-111111111111'
const tenantId = 'a1a1a1a1-1111-4111-8111-111111111111'
const dialect = new PgDialect()
const now = new Date('2026-10-11T12:00:00.000Z')
const pickupAt = new Date('2026-10-11T14:00:00.000Z')
const landedAt = '2026-10-11T11:30:00.000Z'
const guest = 'Ana Anić'
const flight = 'ou 384'
const iata = 'DBV'

interface StoredRide {
  rideId: string
  transferId: string
  state: RideState
  pickupAt: Date
  flightNumber: string | null
  airportMark: boolean
  iata: string | null
  landingAt: Date | null
  expectedArrival: Date | null
  expectedArrivalBasis: Date | null
  driverId: string | null
  timeZone: string
}

function ride(overrides: Partial<StoredRide> = {}): StoredRide {
  return {
    rideId,
    transferId,
    state: 'accepted',
    pickupAt,
    flightNumber: flight,
    airportMark: true,
    iata,
    landingAt: null,
    expectedArrival: null,
    expectedArrivalBasis: null,
    driverId: null,
    timeZone: 'Europe/Zagreb',
    ...overrides,
  }
}

function landed(airport = iata, at = landedAt) {
  return {
    arrivalAirport: airport,
    status: 'landed' as const,
    expectedArrival: null,
    landedAt: at,
  }
}

function fake(stored: StoredRide[]) {
  const queries: string[] = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      const text = compiled.sql
      queries.push(text)
      if (text.includes('l.iata')) {
        return {
          rows: stored.map(row => ({
            rideId: row.rideId,
            transferId: row.transferId,
            state: row.state,
            pickupAt: row.pickupAt,
            flightNumber: row.flightNumber,
            airportMark: row.airportMark,
            iata: row.iata,
            landingAt: row.landingAt,
            expectedArrival: row.expectedArrival,
            expectedArrivalBasis: row.expectedArrivalBasis,
            driverId: row.driverId,
            timeZone: row.timeZone,
          })),
        }
      }
      if (text.includes('set expected_arrival_at')) {
        const row = stored.find(item => item.transferId === compiled.params[2])
        if (row) {
          const next = compiled.params[0]
          const basis = compiled.params[1]
          row.expectedArrival = next instanceof Date ? next : new Date(String(next))
          row.expectedArrivalBasis = basis instanceof Date ? basis : new Date(String(basis))
        }
        return { rows: [] }
      }
      if (text.includes('landing_at is null')) {
        const row = stored.find(item => item.transferId === compiled.params[1])
        if (!row || row.landingAt !== null)
          return { rows: [] }
        const instant = compiled.params[0]
        row.landingAt = instant instanceof Date ? instant : new Date(String(instant))
        return { rows: [{ id: row.transferId }] }
      }
      if (text.includes('where r.id')) {
        const row = stored[0]
        return {
          rows: row
            ? [{ transferId: row.transferId, state: row.state, landingAt: row.landingAt }]
            : [],
        }
      }
      if (text.includes('set landing_at')) {
        const row = stored[0]
        if (row) {
          const instant = compiled.params[0]
          row.landingAt = instant === null || instant === undefined
            ? null
            : instant instanceof Date ? instant : new Date(String(instant))
        }
        return { rows: [] }
      }
      return { rows: [] }
    }),
  }
  return { transaction, queries, stored }
}

function statusPort(arrivals: unknown): FlightStatusPort & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async arrivals(query) {
      calls.push(query)
      return arrivals
    },
  }
}

function logCapture(): { log: Logger, text: () => string } {
  let line = ''
  const destination: Writable = new Writable({
    write(chunk, _encoding, callback) {
      line += String(chunk)
      callback()
    },
  })
  return {
    log: createLogger({ level: 'debug', destination }),
    text: () => line,
  }
}

function noticesPort(): Pick<Mailer, 'notifyArrivalMoved'> & { facts: ArrivalMovedNotice[] } {
  const facts: ArrivalMovedNotice[] = []
  return {
    facts,
    async notifyArrivalMoved(notice) {
      facts.push(notice)
    },
  }
}

async function ask(
  stored: StoredRide[],
  arrivals: unknown,
) {
  const { transaction, queries, stored: rows } = fake(stored)
  const status = statusPort(arrivals)
  const notices = noticesPort()
  const captured = logCapture()
  await refreshFlightLandings({
    now,
    transaction,
    status,
    notices,
    log: captured.log,
  })
  return { queries, rows, status, notices, log: captured.text() }
}

it('stores the landing time when the aircraft has landed, leaves the Ride accepted, and does not notify', async () => {
  const result = await ask([ride()], [landed()])
  expect(result.rows[0]?.landingAt?.toISOString()).toBe(landedAt)
  expect(result.rows[0]?.state).toBe('accepted')
  expect(result.notices.facts).toEqual([])
  expect(result.status.calls).toEqual([{
    designator: 'OU384',
    dates: ['2026-10-10', '2026-10-11', '2026-10-12'],
  }])
  expect(result.queries.some(query => query.includes('update app.rides'))).toBe(false)
  expect(result.log).not.toContain(flight)
  expect(result.log).not.toContain('OU384')
  expect(result.log).not.toContain(iata)
  expect(result.log).not.toContain(guest)
})

it('does not ask again once a landing time is stored', async () => {
  const stored = [ride()]
  await ask(stored, [landed()])
  const again = await ask(stored, [landed('DBV', '2026-10-11T11:00:00.000Z')])
  expect(again.status.calls).toEqual([])
  expect(again.rows[0]?.landingAt?.toISOString()).toBe(landedAt)
})

it('leaves a landing time a person recorded, and writes the actual time after it is cleared', async () => {
  const person = new Date('2026-10-11T10:00:00.000Z')
  const kept = await ask([ride({ landingAt: person })], [landed()])
  expect(kept.status.calls).toEqual([])
  expect(kept.rows[0]?.landingAt).toEqual(person)

  const { transaction, stored } = fake([ride({ landingAt: person })])
  await recordLandingTime(transaction, rideId, null, now)
  expect(stored[0]?.landingAt).toBeNull()

  const written = await ask(stored, [landed()])
  expect(written.rows[0]?.landingAt?.toISOString()).toBe(landedAt)
})

it('refuses a landing time that is still in the future, for a person and for the feed', async () => {
  const { transaction, queries, stored } = fake([ride({ landingAt: new Date('2026-10-11T09:00:00.000Z') })])
  await expect(recordLandingTime(transaction, rideId, new Date('2026-10-11T12:00:00.001Z'), now))
    .rejects
    .toBeInstanceOf(LandingTimeInFutureError)
  expect(queries).toEqual([])
  expect(stored[0]?.landingAt?.toISOString()).toBe('2026-10-11T09:00:00.000Z')

  const feed = await ask([ride()], [landed(iata, '2026-10-11T12:00:00.001Z')])
  expect(feed.rows[0]?.landingAt).toBeNull()
})

it('stores nothing when the arrival is more than 6 hours away, tied, at another airport, or empty', async () => {
  const far = await ask([ride()], [landed(iata, '2026-10-11T07:00:00.000Z')])
  expect(far.rows[0]?.landingAt).toBeNull()
  const tie = await ask([ride()], [
    landed(iata, '2026-10-11T13:00:00.000Z'),
    landed(iata, '2026-10-11T15:00:00.000Z'),
  ])
  expect(tie.rows[0]?.landingAt).toBeNull()
  const elsewhere = await ask([ride()], [landed('SPU')])
  expect(elsewhere.rows[0]?.landingAt).toBeNull()
  const empty = await ask([ride()], [])
  expect(empty.rows[0]?.landingAt).toBeNull()
  expect(empty.log).not.toContain(flight)
  expect(empty.log).not.toContain(iata)
})

it('does not ask a Ride that is not one designator, not an airport pickup, missing an IATA code, finished, or more than 12 hours ahead', async () => {
  const rows = [
    ride({ rideId: '11111111-1111-4111-8111-111111111111', flightNumber: 'OU 384 or OU 392' }),
    ride({ rideId: '22222222-2222-4222-8222-222222222222', airportMark: false }),
    ride({ rideId: '33333333-3333-4333-8333-333333333333', iata: null }),
    ride({ rideId: '44444444-4444-4444-8444-444444444444', state: 'done' }),
    ride({ rideId: '55555555-5555-4555-8555-555555555555', state: 'no-show' }),
    ride({ rideId: '66666666-6666-4666-8666-666666666666', state: 'cancelled' }),
    ride({
      rideId: '77777777-7777-4777-8777-777777777777',
      pickupAt: new Date(now.getTime() + 12 * 60 * 60 * 1000 + 1),
    }),
  ]
  const result = await ask(rows, [landed()])
  expect(result.status.calls).toEqual([])
  expect(result.rows.every(row => row.landingAt === null)).toBe(true)
})

it('asks a pickup that is exactly 12 hours ahead and does not store a landing that is still ahead', async () => {
  const result = await ask([
    ride({ pickupAt: new Date(now.getTime() + 12 * 60 * 60 * 1000) }),
  ], [landed()])
  expect(result.status.calls).toHaveLength(1)
  expect(result.rows[0]?.landingAt).toBeNull()
})

it('refuses a landing time on a finished Ride and leaves the stored time', async () => {
  const { transaction, stored } = fake([ride({ state: 'done', landingAt: new Date(landedAt) })])
  await expect(recordLandingTime(transaction, rideId, null, now)).rejects.toBeInstanceOf(LandingTimeClosedError)
  expect(stored[0]?.landingAt?.toISOString()).toBe(landedAt)
  expect(stored[0]?.state).toBe('done')
})

it('opens the ask on the Tenant from the schedule, every 15 minutes, without waiting', async () => {
  expect(FLIGHT_ASK_EVERY_MINUTES).toBe(15)
  const seen: string[] = []
  const status = statusPort([])
  await askFlightLandings({
    now,
    tenantIds: [tenantId],
    withTenant: async (id, run) => {
      seen.push(id)
      const { transaction } = fake([])
      await run(transaction)
    },
    status,
    notices: noticesPort(),
    log: logCapture().log,
  })
  expect(seen).toEqual([tenantId])
  expect(status.calls).toEqual([])
})

const driverId = 'c1c1c1c1-3333-4333-8333-333333333333'
const firstArrival = '2026-10-11T14:00:00.000Z'

function expected(at: string, airport = iata) {
  return {
    arrivalAirport: airport,
    status: 'expected' as const,
    expectedArrival: at,
    landedAt: null,
  }
}

it('stores the first expected arrival and tells nobody, and leaves the Ride accepted', async () => {
  const result = await ask([ride({ driverId })], [expected(firstArrival)])
  expect(result.rows[0]?.expectedArrival?.toISOString()).toBe(firstArrival)
  expect(result.rows[0]?.expectedArrivalBasis?.toISOString()).toBe(firstArrival)
  expect(result.rows[0]?.state).toBe('accepted')
  expect(result.notices.facts).toEqual([])
  expect(result.queries.some(query => query.includes('update app.rides'))).toBe(false)
  expect(result.log).not.toContain(flight)
  expect(result.log).not.toContain(guest)
})

it('stores a change of 14 minutes and does not hand it to the port', async () => {
  const stored = [ride({
    driverId,
    expectedArrival: new Date(firstArrival),
    expectedArrivalBasis: new Date(firstArrival),
  })]
  const later = '2026-10-11T14:14:00.000Z'
  const result = await ask(stored, [expected(later)])
  expect(result.rows[0]?.expectedArrival?.toISOString()).toBe(later)
  expect(result.rows[0]?.expectedArrivalBasis?.toISOString()).toBe(firstArrival)
  expect(result.notices.facts).toEqual([])
  expect(result.rows[0]?.state).toBe('accepted')
})

it('hands a movement of exactly 15 minutes, earlier or later, with both instants', async () => {
  const earlier = await ask([ride({
    driverId,
    expectedArrival: new Date(firstArrival),
    expectedArrivalBasis: new Date(firstArrival),
  })], [expected('2026-10-11T13:45:00.000Z')])
  expect(earlier.notices.facts).toEqual([{
    rideId,
    driverId,
    previous: firstArrival,
    next: '2026-10-11T13:45:00.000Z',
  }])
  expect(earlier.rows[0]?.state).toBe('accepted')

  const later = await ask([ride({
    driverId,
    expectedArrival: new Date(firstArrival),
    expectedArrivalBasis: new Date(firstArrival),
  })], [expected('2026-10-11T14:15:00.000Z')])
  expect(later.notices.facts).toEqual([{
    rideId,
    driverId,
    previous: firstArrival,
    next: '2026-10-11T14:15:00.000Z',
  }])
  expect(later.rows[0]?.expectedArrivalBasis?.toISOString()).toBe('2026-10-11T14:15:00.000Z')
})

it('stores a movement with no Driver, then hands it once on the next ask after assignment', async () => {
  const stored = [ride()]
  const moved = '2026-10-11T14:20:00.000Z'
  const quiet = await ask(stored, [expected(firstArrival)])
  expect(quiet.notices.facts).toEqual([])
  const held = await ask(stored, [expected(moved)])
  expect(held.notices.facts).toEqual([])
  expect(held.rows[0]?.expectedArrival?.toISOString()).toBe(moved)
  expect(held.rows[0]?.expectedArrivalBasis?.toISOString()).toBe(firstArrival)

  stored[0]!.driverId = driverId
  const told = await ask(stored, [expected(moved)])
  expect(told.notices.facts).toEqual([{
    rideId,
    driverId,
    previous: firstArrival,
    next: moved,
  }])
  const again = await ask(stored, [expected(moved)])
  expect(again.notices.facts).toEqual([])
  expect(again.rows[0]?.state).toBe('accepted')
})
