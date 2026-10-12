import { expect, it } from 'vitest'
import { chooseFlightArrival, flightAskDates, flightDesignator, flightNumberChangeClearsLanding, landingTimeInFuture, parseFlightArrivals, rememberWillNotArrive, sameFlightDesignator, storeExpectedArrival } from './flight-landing'

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

it('clears a landing when the flight designator changes, and keeps it for spacing of the same designator', () => {
  expect(flightNumberChangeClearsLanding('OU384', 'OU 384')).toBe(false)
  expect(flightNumberChangeClearsLanding('OU384', 'OU384')).toBe(false)
  expect(flightNumberChangeClearsLanding(null, null)).toBe(false)
  expect(flightNumberChangeClearsLanding('OU384', 'OU392')).toBe(true)
  expect(flightNumberChangeClearsLanding('OU384', null)).toBe(true)
  expect(flightNumberChangeClearsLanding(null, 'OU384')).toBe(true)
  expect(flightNumberChangeClearsLanding('OU384', 'VIP')).toBe(true)
  expect(flightNumberChangeClearsLanding('VIP', 'VIP 2')).toBe(true)
  expect(flightNumberChangeClearsLanding('VIP', 'meet at desk')).toBe(false)
})

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
  expect(chosen).toEqual({
    kind: 'landed',
    landedAt: new Date('2026-10-11T11:00:00.000Z'),
    expectedArrival: null,
  })

  const far = chooseFlightArrival([
    arrival({ landedAt: '2026-10-11T05:59:59.999Z' }),
  ], pickup, 'DBV')
  expect(far).toEqual({ kind: 'none' })

  const edge = chooseFlightArrival([
    arrival({ landedAt: '2026-10-11T06:00:00.000Z' }),
  ], pickup, 'DBV')
  expect(edge).toEqual({
    kind: 'landed',
    landedAt: new Date('2026-10-11T06:00:00.000Z'),
    expectedArrival: null,
  })
})

it('stores nothing when two arrivals are equally close', () => {
  const chosen = chooseFlightArrival([
    arrival({ landedAt: '2026-10-11T11:00:00.000Z' }),
    arrival({ landedAt: '2026-10-11T13:00:00.000Z' }),
  ], pickup, 'DBV')
  expect(chosen).toEqual({ kind: 'tie' })
})

it('treats an arrival at another airport as a flight that will not arrive here', () => {
  const chosen = chooseFlightArrival([
    arrival({ arrivalAirport: 'SPU', landedAt: '2026-10-11T11:30:00.000Z' }),
  ], pickup, 'DBV')
  expect(chosen).toEqual({ kind: 'will-not-arrive' })
})

it('stores every reported estimate, and tells nobody about the first one', () => {
  const first = new Date('2026-10-11T12:00:00.000Z')
  const stored = storeExpectedArrival(
    { expectedArrival: null, basis: null },
    first,
    true,
  )
  expect(stored).toEqual({ expectedArrival: first, basis: first, moved: null })
})

it('does not call out a change of 14 minutes, and does call out exactly 15 minutes earlier or later', () => {
  const first = new Date('2026-10-11T12:00:00.000Z')
  const memory = { expectedArrival: first, basis: first }
  const earlierBy14 = new Date('2026-10-11T11:46:00.000Z')
  const laterBy14 = new Date('2026-10-11T12:14:00.000Z')
  const earlierBy15 = new Date('2026-10-11T11:45:00.000Z')
  const laterBy15 = new Date('2026-10-11T12:15:00.000Z')

  expect(storeExpectedArrival(memory, earlierBy14, true)).toEqual({
    expectedArrival: earlierBy14,
    basis: first,
    moved: null,
  })
  expect(storeExpectedArrival(memory, laterBy14, true)).toEqual({
    expectedArrival: laterBy14,
    basis: first,
    moved: null,
  })
  expect(storeExpectedArrival(memory, earlierBy15, true)).toEqual({
    expectedArrival: earlierBy15,
    basis: earlierBy15,
    moved: { previous: first, next: earlierBy15 },
  })
  expect(storeExpectedArrival(memory, laterBy15, true)).toEqual({
    expectedArrival: laterBy15,
    basis: laterBy15,
    moved: { previous: first, next: laterBy15 },
  })
})

it('keeps the first estimate as the basis until a Driver is told, including a movement stored with no Driver', () => {
  const first = new Date('2026-10-11T12:00:00.000Z')
  const moved = new Date('2026-10-11T12:20:00.000Z')
  const quiet = storeExpectedArrival({ expectedArrival: first, basis: first }, moved, false)
  expect(quiet).toEqual({ expectedArrival: moved, basis: first, moved: null })

  const told = storeExpectedArrival(quiet, moved, true)
  expect(told).toEqual({
    expectedArrival: moved,
    basis: moved,
    moved: { previous: first, next: moved },
  })
  expect(storeExpectedArrival(told, moved, true).moved).toBeNull()
})

it('measures the next movement from the estimate the Driver was told, not from a smaller change in between', () => {
  const told = new Date('2026-10-11T12:00:00.000Z')
  const nudged = new Date('2026-10-11T12:10:00.000Z')
  const next = new Date('2026-10-11T12:15:00.000Z')
  const afterNudge = storeExpectedArrival({ expectedArrival: told, basis: told }, nudged, true)
  expect(afterNudge.moved).toBeNull()
  expect(storeExpectedArrival(afterNudge, next, true)).toEqual({
    expectedArrival: next,
    basis: next,
    moved: { previous: told, next },
  })
})

it('keeps an expected arrival at this airport, and does not treat a cancelled estimate as one', () => {
  const expected = chooseFlightArrival([
    arrival({ status: 'expected', expectedArrival: '2026-10-11T12:10:00.000Z', landedAt: null }),
  ], pickup, 'DBV')
  expect(expected).toEqual({
    kind: 'expected',
    expectedArrival: new Date('2026-10-11T12:10:00.000Z'),
  })

  const cancelled = chooseFlightArrival([
    arrival({ status: 'cancelled', expectedArrival: '2026-10-11T12:10:00.000Z', landedAt: null }),
  ], pickup, 'DBV')
  expect(cancelled).toEqual({ kind: 'will-not-arrive' })

  const diverted = chooseFlightArrival([
    arrival({
      arrivalAirport: 'SPU',
      status: 'diverted',
      expectedArrival: '2026-10-11T12:10:00.000Z',
      landedAt: null,
    }),
  ], pickup, 'DBV')
  expect(diverted).toEqual({ kind: 'will-not-arrive' })
})

it('hands the will-not-arrive fact once, and stores it without a Driver', () => {
  expect(rememberWillNotArrive({ observed: false, handed: false }, true)).toEqual({
    observed: true,
    handed: true,
    hand: true,
  })
  expect(rememberWillNotArrive({ observed: true, handed: true }, true)).toEqual({
    observed: true,
    handed: true,
    hand: false,
  })
  const stored = rememberWillNotArrive({ observed: false, handed: false }, false)
  expect(stored).toEqual({ observed: true, handed: false, hand: false })
  expect(rememberWillNotArrive(stored, true)).toEqual({
    observed: true,
    handed: true,
    hand: true,
  })
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
