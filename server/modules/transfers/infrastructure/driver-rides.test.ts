import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { loadUpcomingRidesForDriver } from './driver-rides'

const driverId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherDriverId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const acceptedRideId = 'e2e2e2e2-3333-4333-8333-333333333333'
const startLocationId = 'a1b2c3d4-5555-4555-8555-555555555555'
const endLocationId = 'b1b2c3d4-6666-4666-8666-666666666666'
const dialect = new PgDialect()

function fakeTransaction(rows: unknown[]) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      return { rows }
    }),
  }
  return { transaction, queries }
}

it('asks only for this Driver, and only for assigned or accepted, with no pickup horizon', async () => {
  const pickup = new Date('2020-01-15T10:00:00.000Z')
  const { transaction, queries } = fakeTransaction([{
    rideId,
    pickupAt: pickup,
    guestName: 'Ana Anić',
    startLocationId,
    endLocationId,
    passengerCount: 2,
    flightNumber: null,
    airportMark: false,
    price: '10.00',
    payment: 'cash',
    state: 'assigned',
    mustAccept: false,
  }, {
    rideId: acceptedRideId,
    pickupAt: pickup,
    guestName: 'Iva Prihvat',
    startLocationId,
    endLocationId,
    passengerCount: 1,
    flightNumber: null,
    airportMark: false,
    price: '12.00',
    payment: 'card',
    state: 'accepted',
    mustAccept: true,
  }])

  await expect(loadUpcomingRidesForDriver(transaction, driverId)).resolves.toEqual([{
    rideId,
    pickupAt: '2020-01-15T10:00:00.000Z',
    guestName: 'Ana Anić',
    startLocationId,
    endLocationId,
    passengerCount: 2,
    flightNumber: null,
    airportMark: false,
    price: '10.00',
    payment: 'cash',
    state: 'assigned',
    mustAccept: false,
  }, {
    rideId: acceptedRideId,
    pickupAt: '2020-01-15T10:00:00.000Z',
    guestName: 'Iva Prihvat',
    startLocationId,
    endLocationId,
    passengerCount: 1,
    flightNumber: null,
    airportMark: false,
    price: '12.00',
    payment: 'card',
    state: 'accepted',
    mustAccept: true,
  }])

  const sql = queries[0]?.sql.toLowerCase() ?? ''
  const select = sql.split('from')[0] ?? ''
  const where = sql.split('where')[1]?.split('order by')[0] ?? ''
  expect(queries[0]?.params).toEqual([driverId])
  expect(queries[0]?.params).not.toContain(otherDriverId)
  expect(select).toContain('state')
  expect(select).toContain('must_accept')
  expect(where).toContain('assigned')
  expect(where).toContain('accepted')
  expect(where).not.toContain('pickup')
  expect(where).not.toContain('done')
  expect(where).not.toContain('no-show')
  expect(where).not.toContain('cancelled')
  expect(sql).not.toContain('limit')
  expect(sql).toContain('order by')
  expect(sql).toContain('pickup_at')
})

it('refuses a Ride with no must-accept copy', async () => {
  const { transaction } = fakeTransaction([{
    rideId,
    pickupAt: new Date('2020-01-15T10:00:00.000Z'),
    guestName: 'Ana Anić',
    startLocationId,
    endLocationId,
    passengerCount: 2,
    flightNumber: null,
    airportMark: false,
    price: '10.00',
    payment: 'cash',
    state: 'assigned',
    mustAccept: null,
  }])
  await expect(loadUpcomingRidesForDriver(transaction, driverId)).rejects.toThrow()
})

it('returns an empty list when this Driver has no upcoming Ride', async () => {
  const { transaction } = fakeTransaction([])
  await expect(loadUpcomingRidesForDriver(transaction, driverId)).resolves.toEqual([])
})
