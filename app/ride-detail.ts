import type { TransferDayRide } from '../shared'

/** Phone, overlay, or beside the table. 1024 matches the office phone break. 1440 is ADR-0038. */
export type RideDetailLayout = 'phone' | 'overlay' | 'beside'

export function rideDetailLayout(width: number): RideDetailLayout {
  if (width < 1024)
    return 'phone'
  if (width < 1440)
    return 'overlay'
  return 'beside'
}

/**
 * The fields a refresh can change under an open form. The form keeps this
 * snapshot and shows "Vožnja je promijenjena" instead of taking the new row.
 */
export function rideFormStamp(ride: TransferDayRide): string {
  return [
    ride.state,
    ride.driverId ?? '',
    ride.vehicleId ?? '',
    ride.mustAccept === null ? '' : String(ride.mustAccept),
    ride.pickupAt,
    ride.landingAt ?? '',
    ride.expectedArrival ?? '',
    ride.guestName,
    ride.flightNumber ?? '',
    String(ride.passengerCount),
    String(ride.luggageCount),
    String(ride.childSeatCount),
    ride.startLocationId,
    ride.endLocationId,
    ride.tabla,
    ride.note ?? '',
    ride.price,
    ride.payment,
    ride.airportMark ? '1' : '0',
  ].join('\u001F')
}

export type RideDetailCommand = 'assign' | 'vehicle' | 'reassign' | 'landing' | 'accept' | 'correct'
