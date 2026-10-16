import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'
import { placeOccupationStrip, readOccupationStripCollapsed, writeOccupationStripCollapsed } from './occupation-strip'

/**
 * Seams: block placement on the operational-day axis (ADR-0029 window,
 * relocation gap excluded), and the remembered collapsed flag.
 * The strip component is the other seam; these tests do not mount it.
 */

const zone = 'Europe/Zagreb'
const day = '2026-10-16'
const vehicleA = 'c1c1c1c1-1111-4111-8111-111111111111'
const vehicleB = 'c2c2c2c2-2222-4222-8222-222222222222'
const driverA = 'b1b1b1b1-1111-4111-8111-111111111111'
const driverB = 'b2b2b2b2-2222-4222-8222-222222222222'
const rideA = 'e1e1e1e1-1111-4111-8111-111111111111'
const rideB = 'e2e2e2e2-2222-4222-8222-222222222222'

function at(wall: string): string {
  return instantFromWallClock(`${day}T${wall}`, zone).toISOString()
}

function nextDay(wall: string): string {
  return instantFromWallClock(`2026-10-17T${wall}`, zone).toISOString()
}

function ride(partial: {
  rideId?: string
  state?: 'unassigned' | 'assigned' | 'accepted' | 'done' | 'no-show' | 'cancelled'
  pickupAt?: string
  landingAt?: string | null
  driverId?: string | null
  vehicleId?: string | null
}) {
  return {
    rideId: partial.rideId ?? rideA,
    state: partial.state ?? 'assigned' as const,
    pickupAt: partial.pickupAt ?? at('10:00'),
    landingAt: partial.landingAt ?? null,
    driverId: partial.driverId === undefined ? driverA : partial.driverId,
    vehicleId: partial.vehicleId === undefined ? vehicleA : partial.vehicleId,
  }
}

function place(rides: ReturnType<typeof ride>[], roster: { driverId: string, vehicleId: string }[] = [], now = at('17:00')) {
  return placeOccupationStrip({
    day,
    timeZone: zone,
    startHour: 5,
    durationMinutes: 60,
    gapMinutes: 15,
    now: new Date(now),
    rides,
    roster,
  })
}

it('places a block from the pickup for the transfer duration, and not the relocation gap', () => {
  const strip = place([ride({})], [{ driverId: driverA, vehicleId: vehicleA }])
  const block = strip.rows[0]?.blocks[0]
  expect(block?.start).toBe(at('10:00'))
  expect(block?.end).toBe(at('11:00'))
  expect(block?.warning).toBeNull()
  // 05:00 to 10:00 is five hours of a 24-hour operational day.
  expect(block?.left).toBeCloseTo(5 / 24, 6)
  expect(block?.width).toBeCloseTo(1 / 24, 6)
  expect(strip.rows[0]?.rosterDriverIds).toEqual([driverA])
  expect(strip.now).toBeCloseTo(0.5, 6)
})

it('shifts the end to a stored landing plus the duration and keeps the start at the pickup', () => {
  const strip = place([ride({ landingAt: at('10:30') })])
  const block = strip.rows[0]?.blocks[0]
  expect(block?.start).toBe(at('10:00'))
  expect(block?.end).toBe(at('11:30'))
  expect(block?.width).toBeCloseTo(90 / (24 * 60), 6)
})

it('marks an overlap and leaves the relocation gap out of both blocks', () => {
  const strip = place([
    ride({ rideId: rideA, pickupAt: at('10:00') }),
    ride({ rideId: rideB, pickupAt: at('10:30') }),
  ])
  const blocks = strip.rows[0]?.blocks ?? []
  expect(blocks.map(block => [block.rideId, block.start, block.end, block.warning])).toEqual([
    [rideA, at('10:00'), at('11:00'), 'overlap'],
    [rideB, at('10:30'), at('11:30'), 'overlap'],
  ])
})

it('marks a short gap and does not mark a gap equal to the relocation gap', () => {
  const tight = place([
    ride({ rideId: rideA, pickupAt: at('10:00') }),
    ride({ rideId: rideB, pickupAt: at('11:10') }),
  ])
  expect(tight.rows[0]?.blocks.map(block => block.warning)).toEqual(['tight', 'tight'])

  const exact = place([
    ride({ rideId: rideA, pickupAt: at('10:00') }),
    ride({ rideId: rideB, pickupAt: at('11:15') }),
  ])
  expect(exact.rows[0]?.blocks.map(block => block.warning)).toEqual([null, null])
})

it('omits unassigned, finished, and empty windows, and keeps a roster row with no Ride', () => {
  const strip = place([
    ride({ rideId: rideA, state: 'unassigned', vehicleId: null, driverId: null }),
    ride({ rideId: rideB, state: 'done' }),
    ride({
      rideId: 'e3e3e3e3-3333-4333-8333-333333333333',
      state: 'accepted',
      vehicleId: vehicleA,
      pickupAt: at('14:00'),
      landingAt: at('12:00'),
    }),
  ], [
    { driverId: driverB, vehicleId: vehicleB },
  ])
  expect(strip.rows.map(row => [row.vehicleId, row.blocks.length, row.rosterDriverIds])).toEqual([
    [vehicleB, 0, [driverB]],
  ])
})

it('warns when the same Driver overlaps on two Vehicles', () => {
  const strip = place([
    ride({ rideId: rideA, vehicleId: vehicleA, pickupAt: at('10:00') }),
    ride({ rideId: rideB, vehicleId: vehicleB, pickupAt: at('10:30') }),
  ])
  expect(strip.rows.map(row => row.blocks[0]?.warning)).toEqual(['overlap', 'overlap'])
})

it('clips a block that runs past the next start hour', () => {
  const strip = place([ride({ pickupAt: nextDay('04:30') })])
  const block = strip.rows[0]?.blocks[0]
  expect(block?.start).toBe(nextDay('04:30'))
  expect(block?.end).toBe(nextDay('05:30'))
  expect(block?.left).toBeCloseTo(23.5 / 24, 6)
  expect(block?.width).toBeCloseTo(0.5 / 24, 6)
})

it('hides the now line outside the operational day', () => {
  expect(place([], [], at('04:00')).now).toBeNull()
  expect(place([], [], nextDay('05:00')).now).toBeNull()
})

it('remembers a collapsed strip and treats anything else as open', () => {
  const stored = new Map<string, string>()
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value)
    },
  }
  const key = 'transferpro-occupation-strip:tenant:user'
  expect(readOccupationStripCollapsed(storage, key)).toBe(false)
  writeOccupationStripCollapsed(storage, key, true)
  expect(readOccupationStripCollapsed(storage, key)).toBe(true)
  writeOccupationStripCollapsed(storage, key, false)
  expect(readOccupationStripCollapsed(storage, key)).toBe(false)
})
