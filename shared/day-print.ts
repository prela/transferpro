/**
 * The paper day (ADR-0038). One group per Vehicle. Unassigned Rides are a
 * final group, even when their pickup is the earliest on the day. Inside a
 * group, pickup order. A tie on the group's earliest pickup uses the
 * Vehicle id so the sheet does not jump between reloads.
 */
export interface DayPrintRide {
  readonly rideId: string
  readonly vehicleId: string | null
  readonly pickupAt: string
}

export interface DayPrintGroup {
  readonly vehicleId: string | null
  readonly rideIds: readonly string[]
}

function byPickup(left: DayPrintRide, right: DayPrintRide): number {
  const time = left.pickupAt.localeCompare(right.pickupAt)
  return time !== 0 ? time : left.rideId.localeCompare(right.rideId)
}

export function groupDayPrint(rides: readonly DayPrintRide[]): readonly DayPrintGroup[] {
  const assigned = new Map<string, DayPrintRide[]>()
  const unassigned: DayPrintRide[] = []
  for (const ride of rides) {
    if (ride.vehicleId === null) {
      unassigned.push(ride)
      continue
    }
    const list = assigned.get(ride.vehicleId)
    if (list)
      list.push(ride)
    else
      assigned.set(ride.vehicleId, [ride])
  }

  const groups = [...assigned.entries()].map(([vehicleId, items]) => {
    const sorted = [...items].sort(byPickup)
    return { vehicleId, rideIds: sorted.map(ride => ride.rideId), earliest: sorted[0]?.pickupAt ?? '' }
  })
  groups.sort((left, right) => {
    const time = left.earliest.localeCompare(right.earliest)
    return time !== 0 ? time : left.vehicleId.localeCompare(right.vehicleId)
  })

  const result: DayPrintGroup[] = groups.map(group => ({ vehicleId: group.vehicleId, rideIds: group.rideIds }))
  if (unassigned.length > 0) {
    const sorted = [...unassigned].sort(byPickup)
    result.push({ vehicleId: null, rideIds: sorted.map(ride => ride.rideId) })
  }
  return result
}
