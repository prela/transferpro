import { expect, it } from 'vitest'
import { groupDayPrint } from './day-print'

/**
 * "Ispiši dan" (issue #260). Groups follow the earliest pickup, and
 * unassigned Rides stay last even when their pickup is earlier.
 */

const VEHICLE_A = '00000000-0000-4000-8000-00000000000a'
const VEHICLE_B = '00000000-0000-4000-8000-00000000000b'

function ride(rideId: string, vehicleId: string | null, pickupAt: string) {
  return { rideId, vehicleId, pickupAt }
}

it('groups by Vehicle, orders groups by earliest pickup, and leaves unassigned last', () => {
  const groups = groupDayPrint([
    ride('unassigned-early', null, '2026-10-16T06:00:00.000Z'),
    ride('a-later', VEHICLE_A, '2026-10-16T09:00:00.000Z'),
    ride('b-only', VEHICLE_B, '2026-10-16T07:00:00.000Z'),
    ride('a-first', VEHICLE_A, '2026-10-16T08:00:00.000Z'),
  ])

  expect(groups).toEqual([
    { vehicleId: VEHICLE_B, rideIds: ['b-only'] },
    { vehicleId: VEHICLE_A, rideIds: ['a-first', 'a-later'] },
    { vehicleId: null, rideIds: ['unassigned-early'] },
  ])
})

it('returns no group when the day has no Rides', () => {
  expect(groupDayPrint([])).toEqual([])
})

it('breaks a tie on the same earliest pickup by Vehicle id', () => {
  const groups = groupDayPrint([
    ride('b', VEHICLE_B, '2026-10-16T08:00:00.000Z'),
    ride('a', VEHICLE_A, '2026-10-16T08:00:00.000Z'),
  ])

  expect(groups.map(group => group.vehicleId)).toEqual([VEHICLE_A, VEHICLE_B])
})
