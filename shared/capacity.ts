/**
 * The Capacity contract (ADR-0034): how a Ride occupies its Driver and its
 * Vehicle (ADR-0029), and the judge. The server module `capacity`, the
 * browser pre-check, the board warnings, and the occupation strip all use
 * this one rule, so what the screen shows is what the save checks.
 * The minutes live on the Tenant: transfer duration and relocation gap.
 * A No-show wait is not this duration.
 */

export type ScheduleResource = 'driver' | 'vehicle'

/** A window can cover a Driver, a Vehicle, or a Partner. An overlap cannot name a Partner. */
export type UnavailableResource = ScheduleResource | 'partner'

/** One occupying Ride. The caller has already dropped done, no-show, cancelled, and unassigned. */
export interface ScheduleRide {
  readonly rideId: string
  readonly pickupAt: Date
  readonly landingAt: Date | null
  readonly driverId: string
  readonly vehicleId: string
}

export interface ScheduleClash {
  readonly resource: ScheduleResource
  readonly rideId: string
}

export interface ScheduleVerdict {
  readonly overlaps: readonly ScheduleClash[]
  readonly tightGaps: readonly ScheduleClash[]
}

/**
 * The occupied end. A stored landing replaces the pickup as the start of
 * the duration. The window opens at the pickup. A landing that finishes
 * the duration before the pickup leaves an empty window.
 */
export function occupiedEnd(pickupAt: Date, landingAt: Date | null, durationMinutes: number): Date {
  const basis = landingAt ?? pickupAt
  return new Date(basis.getTime() + durationMinutes * 60_000)
}

/**
 * True overlap is a shared instant. A gap shorter than `gapMinutes` that
 * does not overlap is a tight relocation. A gap of exactly `gapMinutes`
 * is neither. The Ride being judged is ignored if it appears in `others`.
 */
export function judgeSchedule(
  subject: ScheduleRide,
  others: readonly ScheduleRide[],
  durationMinutes: number,
  gapMinutes: number,
): ScheduleVerdict {
  const overlaps: ScheduleClash[] = []
  const tightGaps: ScheduleClash[] = []
  const subjectEnd = occupiedEnd(subject.pickupAt, subject.landingAt, durationMinutes)
  for (const other of others) {
    if (other.rideId === subject.rideId)
      continue
    const otherEnd = occupiedEnd(other.pickupAt, other.landingAt, durationMinutes)
    const overlapsTime = intervalsOverlap(subject.pickupAt, subjectEnd, other.pickupAt, otherEnd)
    const tight = !overlapsTime && gapIsTight(subject.pickupAt, subjectEnd, other.pickupAt, otherEnd, gapMinutes)
    for (const resource of sharedResources(subject, other)) {
      const clash = { resource, rideId: other.rideId }
      if (overlapsTime)
        overlaps.push(clash)
      else if (tight)
        tightGaps.push(clash)
    }
  }
  return { overlaps, tightGaps }
}

/**
 * The board's overlap warning (ADR-0034). The other Rides that truly
 * overlap `subject` or sit inside the relocation gap, each named once, in
 * the order given. A tight gap and a true overlap are one warning, and a
 * gap equal to the relocation gap is none.
 */
export function overlappingRideIds(
  subject: ScheduleRide,
  others: readonly ScheduleRide[],
  durationMinutes: number,
  gapMinutes: number,
): string[] {
  const verdict = judgeSchedule(subject, others, durationMinutes, gapMinutes)
  const ids: string[] = []
  for (const clash of [...verdict.overlaps, ...verdict.tightGaps]) {
    if (!ids.includes(clash.rideId))
      ids.push(clash.rideId)
  }
  return ids
}

function sharedResources(subject: ScheduleRide, other: ScheduleRide): ScheduleResource[] {
  const resources: ScheduleResource[] = []
  if (subject.driverId === other.driverId)
    resources.push('driver')
  if (subject.vehicleId === other.vehicleId)
    resources.push('vehicle')
  return resources
}

/** Half-open windows. An empty window (end at or before the start) occupies nothing. */
export function intervalsOverlap(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  if (endA.getTime() <= startA.getTime() || endB.getTime() <= startB.getTime())
    return false
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime()
}

function gapIsTight(startA: Date, endA: Date, startB: Date, endB: Date, gapMinutes: number): boolean {
  const gapMs = gapMinutes * 60_000
  const aThenB = endA.getTime() <= startB.getTime() && endA.getTime() + gapMs > startB.getTime()
  const bThenA = endB.getTime() <= startA.getTime() && endB.getTime() + gapMs > startA.getTime()
  return aThenB || bThenA
}
