import type { DisplayLocale } from './display-locale'
import type { PaymentMethod } from './transfer'
import { z } from 'zod'
import { formatInstant } from './format-instant'
import { rideSchema } from './transfer'

/**
 * The mail for one assigned Ride. The locale and the time zone are the
 * Tenant's, not the Driver's UI locale. A Vehicle has no name column:
 * `vehicleName` is the description when one is stored, and the plate is
 * always stated. Cash is the only payment that adds a price line.
 * ADR-0026. The mail has no link and does not ask the Driver to accept.
 */
export interface AssignedWorkOrderFacts {
  readonly locale: DisplayLocale
  readonly timeZone: string
  readonly pickupAt: Date
  readonly pickupPlace: string
  readonly dropOffPlace: string
  readonly guestName: string
  readonly tabla: string
  readonly passengerCount: number
  readonly luggageCount: number
  readonly childSeatCount: number
  readonly flightNumber: string | null
  readonly clientName: string
  readonly vehicleName: string | null
  readonly vehiclePlate: string
  readonly note: string | null
  readonly payment: PaymentMethod
  readonly price: string
}

export interface WorkOrderMessage {
  readonly subject: string
  readonly text: string
  readonly html: string
}

const COPY = {
  hr: {
    status: 'Dodijeljeno',
    departure: 'Polazak',
    pickup: 'Polazište',
    dropOff: 'Odredište',
    guest: 'Gost',
    tabla: 'Tabla',
    passengers: 'Putnici',
    luggage: 'Prtljaga',
    childSeats: 'Dječje sjedalice',
    flight: 'Let',
    client: 'Klijent',
    vehicle: 'Vozilo',
    plate: 'Registracija',
    note: 'Napomena',
    price: 'Cijena',
    payment: 'Plaćanje',
    cash: 'Gotovina',
  },
  en: {
    status: 'Assigned',
    departure: 'Departure',
    pickup: 'Pickup',
    dropOff: 'Drop-off',
    guest: 'Guest',
    tabla: 'Meet sign',
    passengers: 'Passengers',
    luggage: 'Luggage',
    childSeats: 'Child seats',
    flight: 'Flight',
    client: 'Client',
    vehicle: 'Vehicle',
    plate: 'Plate',
    note: 'Note',
    price: 'Price',
    payment: 'Payment',
    cash: 'Cash',
  },
} as const

/**
 * Subject is the status, the departure, and the pickup place.
 * The flight line is omitted when the number is blank. Card and
 * invoice-to-agency have no price and no payment line.
 */
export function composeAssignedWorkOrder(facts: AssignedWorkOrderFacts): WorkOrderMessage {
  const copy = COPY[facts.locale]
  const departure = formatInstant(facts.pickupAt, facts.timeZone, facts.locale)
  const lines = [
    copy.status,
    line(copy.departure, departure),
    line(copy.pickup, facts.pickupPlace),
    line(copy.dropOff, facts.dropOffPlace),
    line(copy.guest, facts.guestName),
    line(copy.tabla, facts.tabla),
    line(copy.passengers, String(facts.passengerCount)),
    line(copy.luggage, String(facts.luggageCount)),
    line(copy.childSeats, String(facts.childSeatCount)),
  ]
  const flight = facts.flightNumber?.trim() ?? ''
  if (flight !== '')
    lines.push(line(copy.flight, flight))
  lines.push(line(copy.client, facts.clientName))
  const vehicleName = facts.vehicleName?.trim() ?? ''
  if (vehicleName !== '')
    lines.push(line(copy.vehicle, vehicleName))
  lines.push(line(copy.plate, facts.vehiclePlate))
  lines.push(line(copy.note, facts.note ?? ''))
  // Assigned cash is the only case this slice mails. The price stays off
  // every other method, including when a fare is stored on the Transfer.
  if (facts.payment === 'cash') {
    const shown = facts.locale === 'hr' ? facts.price.replace('.', ',') : facts.price
    lines.push(line(copy.price, shown))
    lines.push(line(copy.payment, copy.cash))
  }
  const text = lines.join('\n')
  const html = lines.map(item => `<p>${escapeHtml(item)}</p>`).join('')
  return {
    subject: `${copy.status} · ${departure} · ${facts.pickupPlace}`,
    text,
    html,
  }
}

export const WORK_ORDER_OUTCOMES = ['sent', 'no_email', 'failed'] as const

export const workOrderNoticeSchema = z.object({
  driverId: z.uuid(),
  outcome: z.enum(WORK_ORDER_OUTCOMES),
})

export type WorkOrderNotice = z.infer<typeof workOrderNoticeSchema>

/**
 * The assign action. One notice for the Driver who received the Ride.
 * The address is not on this object.
 */
export const assignedRideSchema = z.object({
  ride: rideSchema,
  workOrders: z.array(workOrderNoticeSchema),
})

export type AssignedRide = z.infer<typeof assignedRideSchema>

function line(label: string, value: string): string {
  return `${label}: ${value}`
}

/** Office text can contain < or &. The mail is text plus these paragraphs, never a link. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
