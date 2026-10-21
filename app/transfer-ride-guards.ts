import type { TransferDayRide } from '../shared'
import { canCancelRide, canChangeHandedOffPartner, canCloseHandedOffRide, canHandOffRide, canMarkNoShow, canMarkRideDone, canTakeBackHandedOffRide } from '../shared'

/**
 * The copied flag and `assigned` are both required. An accepted Ride still
 * has the flag, and an assigned Ride that does not require acceptance has
 * no control. The flag is the copy on the Ride, not the Driver's current setting.
 */
export function canRecordAcceptanceByPhone(ride: TransferDayRide): boolean {
  return ride.state === 'assigned' && ride.mustAccept === true
}

/**
 * Flag off from `assigned`. Flag on only from `accepted`. A handed-off Ride
 * can be closed at any time, with no Driver and no wait (ADR-0048).
 */
export function canFinish(ride: TransferDayRide): boolean {
  return canMarkRideDone(ride.state, ride.mustAccept) || canCloseHandedOffRide(ride.state)
}

/** The same source state as done. The office may mark a No-show before the wait. */
export function canNoShow(ride: TransferDayRide): boolean {
  return canMarkNoShow(ride.state, ride.mustAccept) || canCloseHandedOffRide(ride.state)
}

/** Unassigned, assigned, or accepted. A handed-off Ride already has a Partner. */
export function canHandOff(ride: TransferDayRide): boolean {
  return canHandOffRide(ride.state)
}

/** A handed-off Ride can move to another active Partner without a take-back. */
export function canChangePartner(ride: TransferDayRide): boolean {
  return canChangeHandedOffPartner(ride.state) && ride.partnerId !== null
}

/** A handed-off Ride returns to unassigned. Closing it does not. */
export function canTakeBack(ride: TransferDayRide): boolean {
  return canTakeBackHandedOffRide(ride.state) && ride.partnerId !== null
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
