import { expect, it } from 'vitest'
import { judgeSchedule, occupiedEnd } from './capacity'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const subjectId = 'e1e1e1e1-2222-4222-8222-222222222222'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'

const durationMinutes = 60
const gapMinutes = 15

function at(hours: number, minutes: number): Date {
  return new Date(Date.UTC(2026, 5, 1, hours, minutes, 0))
}

function ride(pickupAt: Date, landingAt: Date | null, ids: { rideId?: string, driverId?: string, vehicleId?: string } = {}) {
  return {
    rideId: ids.rideId ?? otherId,
    pickupAt,
    landingAt,
    driverId: ids.driverId ?? driverId,
    vehicleId: ids.vehicleId ?? vehicleId,
  }
}

const subject = ride(at(10, 0), null, { rideId: subjectId })

function judge(other: ReturnType<typeof ride>) {
  return judgeSchedule(subject, [other], durationMinutes, gapMinutes)
}

it('ends the window at the pickup plus the transfer duration when no landing is stored', () => {
  expect(occupiedEnd(at(10, 0), null, 60).toISOString()).toBe(at(11, 0).toISOString())
})

it('ends the window at the landing plus the transfer duration when a landing is stored', () => {
  expect(occupiedEnd(at(10, 0), at(10, 30), 60).toISOString()).toBe(at(11, 30).toISOString())
})

it('hard-overlaps the same Driver when the windows share an instant', () => {
  expect(judge(ride(at(10, 30), null))).toEqual({
    overlaps: [{ resource: 'driver', rideId: otherId }, { resource: 'vehicle', rideId: otherId }],
    tightGaps: [],
  })
})

it('warns when the next pickup is inside the relocation gap and the windows do not overlap', () => {
  // Subject ends 11:00. 11:10 is ten minutes later, inside a 15-minute gap.
  expect(judge(ride(at(11, 10), null, { vehicleId: otherVehicleId }))).toEqual({
    overlaps: [],
    tightGaps: [{ resource: 'driver', rideId: otherId }],
  })
})

it('allows a gap equal to the relocation gap', () => {
  expect(judge(ride(at(11, 15), null))).toEqual({ overlaps: [], tightGaps: [] })
})

it('treats a window that ends at the next pickup as a tight gap, not an overlap', () => {
  expect(judge(ride(at(11, 0), null, { vehicleId: otherVehicleId }))).toEqual({
    overlaps: [],
    tightGaps: [{ resource: 'driver', rideId: otherId }],
  })
})

it('warns when the previous Ride ends inside the gap before this pickup', () => {
  expect(judge(ride(at(8, 50), null, { driverId: otherDriverId }))).toEqual({
    overlaps: [],
    tightGaps: [{ resource: 'vehicle', rideId: otherId }],
  })
})

it('overlaps a later Ride once a landing stretches the occupied end', () => {
  const landed = ride(at(10, 0), at(10, 30), { rideId: subjectId })
  const later = ride(at(11, 20), null, { vehicleId: otherVehicleId })
  expect(judgeSchedule(landed, [later], durationMinutes, gapMinutes)).toEqual({
    overlaps: [{ resource: 'driver', rideId: otherId }],
    tightGaps: [],
  })
})

it('does not treat that later Ride as an overlap when no landing is stored', () => {
  expect(judge(ride(at(11, 20), null, { vehicleId: otherVehicleId }))).toEqual({
    overlaps: [],
    tightGaps: [],
  })
})

it('ignores a Ride that shares neither the Driver nor the Vehicle', () => {
  expect(judge(ride(at(10, 0), null, { driverId: otherDriverId, vehicleId: otherVehicleId }))).toEqual({
    overlaps: [],
    tightGaps: [],
  })
})

it('ignores the Ride being judged when it is listed among the others', () => {
  expect(judgeSchedule(subject, [subject], durationMinutes, gapMinutes)).toEqual({ overlaps: [], tightGaps: [] })
})

it('still overlaps a Ride whose pickup is already in the past', () => {
  const underway = ride(at(10, 0), null, { rideId: subjectId })
  const earlier = ride(at(9, 30), null)
  expect(judgeSchedule(underway, [earlier], durationMinutes, gapMinutes).overlaps).toEqual([
    { resource: 'driver', rideId: otherId },
    { resource: 'vehicle', rideId: otherId },
  ])
})
