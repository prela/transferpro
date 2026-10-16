import type { DisplayLocale } from './display-locale'
import type { PaymentMethod } from './transfer'
import { wallClockInTimeZone } from './date'

/**
 * Fields a new Transfer form can show. There is no Transfer id and no Ride
 * id: duplicate and return only prefill the form (ADR-0038). The server
 * creates a new Transfer, with its own external reference, when it is saved.
 */
export interface TransferPrefill {
  readonly clientId: string
  readonly pickupWall: string
  readonly startLocationId: string
  readonly endLocationId: string
  readonly passengers: string
  readonly guest: string
  readonly price: string
  readonly payment: PaymentMethod
  readonly flight: string
  readonly airportMark: boolean
  readonly tabla: string
  readonly clientReference: string
  readonly luggage: string
  readonly childSeats: string
  readonly note: string
}

/** The booking columns the form copies. Assignment and landing stay off it. */
export interface TransferPrefillSource {
  readonly clientId: string
  readonly pickupAt: string
  readonly startLocationId: string
  readonly endLocationId: string
  readonly passengerCount: number
  readonly guestName: string
  readonly price: string
  readonly payment: PaymentMethod
  readonly flightNumber: string | null
  readonly airportMark: boolean
  readonly tabla: string
  readonly clientReference: string | null
  readonly luggageCount: number
  readonly childSeatCount: number
  readonly note: string | null
}

function priceForLocale(amount: string, locale: DisplayLocale): string {
  return locale === 'hr' ? amount.replace('.', ',') : amount
}

function booking(source: TransferPrefillSource, locale: DisplayLocale): Omit<TransferPrefill, 'pickupWall' | 'startLocationId' | 'endLocationId' | 'flight' | 'tabla'> {
  return {
    clientId: source.clientId,
    passengers: String(source.passengerCount),
    guest: source.guestName,
    price: priceForLocale(source.price, locale),
    payment: source.payment,
    airportMark: source.airportMark,
    clientReference: source.clientReference ?? '',
    luggage: String(source.luggageCount),
    childSeats: String(source.childSeatCount),
    note: source.note ?? '',
  }
}

/**
 * A second Transfer with the same booking. The pickup is the wall clock in
 * the Tenant zone so the form shows the same time the row showed.
 */
export function duplicateTransferPrefill(source: TransferPrefillSource, timeZone: string, locale: DisplayLocale): TransferPrefill {
  return {
    ...booking(source, locale),
    pickupWall: wallClockInTimeZone(timeZone, new Date(source.pickupAt)),
    startLocationId: source.startLocationId,
    endLocationId: source.endLocationId,
    flight: source.flightNumber ?? '',
    tabla: source.tabla,
  }
}

/**
 * A return journey. From and to swap. Client, Client reference, guest,
 * passengers, luggage, child seats, payment, price, note, and the airport
 * mark stay. Time, flight number, and tabla are empty so the office fills
 * the new leg. ADR-0038 names the kept and emptied fields; price, note, and
 * the airport mark are not in the emptied list, so they are copied.
 */
export function returnTransferPrefill(source: TransferPrefillSource, locale: DisplayLocale): TransferPrefill {
  return {
    ...booking(source, locale),
    pickupWall: '',
    startLocationId: source.endLocationId,
    endLocationId: source.startLocationId,
    flight: '',
    tabla: '',
  }
}
