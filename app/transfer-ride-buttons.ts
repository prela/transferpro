/** Ids the row renders and the command dialogs focus when they close. */
export function assignButtonId(rideId: string): string {
  return `assign-ride-${rideId}`
}

export function acceptByPhoneButtonId(rideId: string): string {
  return `accept-by-phone-${rideId}`
}

export function markDoneButtonId(rideId: string): string {
  return `mark-done-${rideId}`
}

export function markNoShowButtonId(rideId: string): string {
  return `mark-no-show-${rideId}`
}

export function cancelRideButtonId(rideId: string): string {
  return `cancel-ride-${rideId}`
}

export function changeVehicleButtonId(rideId: string): string {
  return `change-vehicle-${rideId}`
}

export function reassignRideButtonId(rideId: string): string {
  return `reassign-ride-${rideId}`
}

export function clearRideButtonId(rideId: string): string {
  return `clear-ride-${rideId}`
}
