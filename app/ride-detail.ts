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
    ride.clientId,
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

/** Office controls are 28 px. The phone uses 44–48 px. ADR-0038. */
export function commandControlSize(phone: boolean): 'sm' | 'xl' {
  return phone ? 'xl' : 'sm'
}

export function commandControlClass(phone: boolean): string {
  return phone ? 'min-h-12' : 'h-7 min-h-7'
}

/**
 * Size `sm` is 14 px, and 12 px from the `md` breakpoint. Inputs stay 16 px
 * on every layout. ADR-0038.
 */
export const commandInputClass = '[&_input]:!text-base [&_textarea]:!text-base [&_[role=combobox]]:!text-base'
