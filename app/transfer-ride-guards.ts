import type { TransferDayRide } from '../shared'
import { canCancelRide, canMarkNoShow, canMarkRideDone } from '../shared'

/**
 * The copied flag and `assigned` are both required. An accepted Ride still
 * has the flag, and an assigned Ride that does not require acceptance has
 * no control. The flag is the copy on the Ride, not the Driver's current setting.
 */
export function canRecordAcceptanceByPhone(ride: TransferDayRide): boolean {
  return ride.state === 'assigned' && ride.mustAccept === true
}

/** Flag off from `assigned`. Flag on only from `accepted`. Unassigned has no control. */
export function canFinish(ride: TransferDayRide): boolean {
  return canMarkRideDone(ride.state, ride.mustAccept)
}

/** The same source state as done. The office may mark a No-show before the wait. */
export function canNoShow(ride: TransferDayRide): boolean {
  return canMarkNoShow(ride.state, ride.mustAccept)
}

/** Unassigned, assigned, or accepted. A terminal Ride has no control. The Driver cannot cancel. */
export function canCallOff(ride: TransferDayRide): boolean {
  return canCancelRide(ride.state)
}

/** Assigned or accepted, with both a Driver and a Vehicle. Those are the three office commands. */
export function canChangeAssignment(ride: TransferDayRide): boolean {
  return (ride.state === 'assigned' || ride.state === 'accepted')
    && ride.driverId !== null
    && ride.vehicleId !== null
}
