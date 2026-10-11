import { expect, it } from 'vitest'
import { chooseFlightArrival, flightAskDates, flightDesignator, landingTimeInFuture, parseFlightArrivals, sameFlightDesignator } from './flight-landing'

const pickup = new Date('2026-10-11T12:00:00.000Z')

function arrival(partial: {
  arrivalAirport?: string
  status?: 'expected' | 'landed' | 'cancelled' | 'diverted'
  expectedArrival?: string | null
  landedAt?: string | null
}) {
  return {
    arrivalAirport: partial.arrivalAirport ?? 'DBV',
    status: partial.status ?? 'landed',
    expectedArrival: partial.expectedArrival === undefined || partial.expectedArrival === null
      ? null
      : new Date(partial.expectedArrival),
    landedAt: partial.landedAt === undefined || partial.landedAt === null
      ? null
      : new Date(partial.landedAt),
  }
}

it('treats OU384, OU 384, and ou 384 as one designator, and leaves a note alone', () => {
  expect(flightDesignator('OU384')).toBe('OU384')
  expect(flightDesignator('OU 384')).toBe('OU384')
  expect(flightDesignator('ou 384')).toBe('OU384')
  expect(sameFlightDesignator('OU384', 'ou 384')).toBe(true)
  expect(flightDesignator('OU 384 or OU 392')).toBeNull()
  expect(flightDesignator('O 384')).toBeNull()
  expect(flightDesignator('ßa 1')).toBeNull()
  expect(flightDesignator(null)).toBeNull()
})

it('asks the pickup calendar date and the day on either side in the Tenant zone', () => {
  // 00:30 in Zagreb is still the previous UTC date.
  const justAfterMidnight = new Date('2026-10-10T22:30:00.000Z')
  expect(flightAskDates(justAfterMidnight, 'Europe/Zagreb')).toEqual([
    '2026-10-10',
    '2026-10-11',
    '2026-10-12',
  ])
})

it('keeps the closest arrival inside 6 hours and drops one further away', () => {
  const chosen = chooseFlightArrival([
    arrival({ landedAt: '2026-10-11T07:00:00.000Z' }),
    arrival({ landedAt: '2026-10-11T11:00:00.000Z' }),
  ], pickup, 'DBV')
  expect(chosen).toEqual({ kind: 'landed', landedAt: new Date('2026-10-11T11:00:00.000Z') })

  const far = chooseFlightArrival([
    arrival({ landedAt: '2026-10-11T05:59:59.999Z' }),
  ], pickup, 'DBV')
  expect(far).toEqual({ kind: 'none' })

  const edge = chooseFlightArrival([
    arrival({ landedAt: '2026-10-11T06:00:00.000Z' }),
  ], pickup, 'DBV')
  expect(edge).toEqual({ kind: 'landed', landedAt: new Date('2026-10-11T06:00:00.000Z') })
})

it('stores nothing when two arrivals are equally close', () => {
  const chosen = chooseFlightArrival([
    arrival({ landedAt: '2026-10-11T11:00:00.000Z' }),
    arrival({ landedAt: '2026-10-11T13:00:00.000Z' }),
  ], pickup, 'DBV')
  expect(chosen).toEqual({ kind: 'tie' })
})

it('does not treat another airport as a landing here', () => {
  const chosen = chooseFlightArrival([
    arrival({ arrivalAirport: 'SPU', landedAt: '2026-10-11T11:30:00.000Z' }),
  ], pickup, 'DBV')
  expect(chosen).toEqual({ kind: 'elsewhere' })
})

it('refuses a landing time that is still ahead of now, and accepts now', () => {
  const now = new Date('2026-10-11T12:00:00.000Z')
  expect(landingTimeInFuture(new Date('2026-10-11T12:00:00.001Z'), now)).toBe(true)
  expect(landingTimeInFuture(now, now)).toBe(false)
})

it('reads a status list and rejects a payload that is not one', () => {
  expect(parseFlightArrivals([{
    arrivalAirport: 'DBV',
    status: 'landed',
    expectedArrival: null,
    landedAt: '2026-10-11T11:30:00.000Z',
  }])).toEqual([{
    arrivalAirport: 'DBV',
    status: 'landed',
    expectedArrival: null,
    landedAt: new Date('2026-10-11T11:30:00.000Z'),
  }])
  expect(parseFlightArrivals([])).toEqual([])
  expect(parseFlightArrivals({ flight: 'OU 384' })).toBeNull()
})
