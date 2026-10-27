import type { DisplayLocale } from './display-locale'
import type { PaymentMethod, TransferGroupRole } from './transfer'
import { z } from 'zod'
import { formatInstant } from './format-instant'
import { rideSchema, transferSchema } from './transfer'

/**
 * The mail for one assigned Ride. The locale and the time zone are the
 * Tenant's, not the Driver's UI locale. A Vehicle has no name column:
 * `vehicleName` is the description when one is stored, and the plate is
 * always stated. Cash is the only payment that adds a price line, and an
 * extra vehicle adds neither a price nor a payment line (ADR-0054).
 * ADR-0026. The mail has no link and does not ask the Driver to accept.
 * `passengerCount` is this vehicle's count. The group's ordered count is
 * not a fact on this mail.
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
  /** Absent when the Transfer has no Client reference. A blank is absent. */
  readonly clientReference: string | null
  /**
   * `extra` hides the price and the payment, whatever the method.
   * `main` is still a group and still shows a cash price. Null is not a group.
   */
  readonly groupRole: TransferGroupRole | null
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

export const WORK_ORDER_STATUSES = ['assigned', 'changed', 'cancelled', 'no_longer_yours'] as const

export type WorkOrderStatus = typeof WORK_ORDER_STATUSES[number]

const STATUS_COPY = {
  hr: {
    assigned: 'Dodijeljeno',
    changed: 'Promijenjeno',
    cancelled: 'Otkazano',
    no_longer_yours: 'Više nije vaše',
  },
  en: {
    assigned: 'Assigned',
    changed: 'Changed',
    cancelled: 'Cancelled',
    no_longer_yours: 'No longer yours',
  },
} as const

const COPY = {
  hr: {
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
    clientReference: 'Referenca naručitelja',
    group: 'Grupa',
    vehicle: 'Vozilo',
    plate: 'Registracija',
    note: 'Napomena',
    price: 'Cijena',
    payment: 'Plaćanje',
    cash: 'Gotovina',
  },
  en: {
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
    clientReference: 'Client reference',
    group: 'Group',
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
 * The flight line is omitted when the number is blank. The Client reference
 * is stated when one is set. A Ride in a group is marked. Card,
 * invoice-to-agency, and an extra vehicle have no price and no payment
 * line. Cancelled and no longer yours never state a price, even for cash.
 * ADR-0026, ADR-0054.
 */
export function composeWorkOrder(
  facts: AssignedWorkOrderFacts,
  status: WorkOrderStatus = 'assigned',
): WorkOrderMessage {
  const copy = COPY[facts.locale]
  const statusLabel = STATUS_COPY[facts.locale][status]
  const departure = formatInstant(facts.pickupAt, facts.timeZone, facts.locale)
  const lines = [
    statusLabel,
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
  const reference = facts.clientReference?.trim() ?? ''
  if (reference !== '')
    lines.push(line(copy.clientReference, reference))
  // A mark, not a value. The group's ordered passenger count stays off the mail.
  if (facts.groupRole !== null)
    lines.push(copy.group)
  const vehicleName = facts.vehicleName?.trim() ?? ''
  if (vehicleName !== '')
    lines.push(line(copy.vehicle, vehicleName))
  lines.push(line(copy.plate, facts.vehiclePlate))
  lines.push(line(copy.note, facts.note ?? ''))
  // Assigned and changed cash state the price. Cancelled and no longer
  // yours never do. Card, invoice-to-agency, and an extra vehicle stay
  // silent, including when a fare is stored (ADR-0054).
  if ((status === 'assigned' || status === 'changed') && facts.payment === 'cash' && facts.groupRole !== 'extra') {
    const shown = facts.locale === 'hr' ? facts.price.replace('.', ',') : facts.price
    lines.push(line(copy.price, shown))
    lines.push(line(copy.payment, copy.cash))
  }
  const text = lines.join('\n')
  const html = lines.map(item => `<p>${escapeHtml(item)}</p>`).join('')
  return {
    subject: `${statusLabel} · ${departure} · ${facts.pickupPlace}`,
    text,
    html,
  }
}

/** Assigned mail. A change or a clear passes its status to `composeWorkOrder`. */
export function composeAssignedWorkOrder(facts: AssignedWorkOrderFacts): WorkOrderMessage {
  return composeWorkOrder(facts, 'assigned')
}

export const WORK_ORDER_OUTCOMES = ['sent', 'no_email', 'failed', 'stale'] as const

export const workOrderNoticeSchema = z.object({
  driverId: z.uuid(),
  outcome: z.enum(WORK_ORDER_OUTCOMES),
})

export type WorkOrderNotice = z.infer<typeof workOrderNoticeSchema>

export const relocationWarningSchema = z.object({
  resource: z.enum(['driver', 'vehicle']),
  rideId: z.uuid(),
})

export type RelocationWarning = z.infer<typeof relocationWarningSchema>

/**
 * One Ride this cancel wrote, with that Ride's own work-order result.
 * `workOrders` is empty when the Ride had no Driver. A handed-off Ride
 * has no Driver. The address is not on this object.
 */
export const cancelledRideMemberSchema = z.object({
  ride: rideSchema,
  workOrders: z.array(workOrderNoticeSchema),
})

/**
 * A cancel. `workOrders` is the named Ride: empty when it had no Driver,
 * and one entry when it had one. `cancelled` is present when unfinished
 * extra vehicles were cancelled with that Ride. The named Ride is first,
 * then each extra vehicle. A cancel that writes one Ride omits `cancelled`,
 * so the body stays `{ ride, workOrders }`. The address is not on this object.
 */
export const cancelledRideResultSchema = z.object({
  ride: rideSchema,
  workOrders: z.array(workOrderNoticeSchema),
  cancelled: z.array(cancelledRideMemberSchema).optional(),
})

export type CancelledRideResult = z.infer<typeof cancelledRideResultSchema>

/**
 * A Transfer correction. `workOrders` is empty when nothing was mailed:
 * no Driver, a save that changed no mailed fact, or a price change while
 * payment is not cash. A Client reference change is a mailed fact. The
 * group's ordered passenger count is not. One entry when the current Driver
 * was mailed changed. `relocationWarnings` names a tight gap. It is empty when the
 * correction was not judged or the gap is enough. A true overlap is a 409
 * and is not in this list. `unfinishedExtraVehicleCount` is how many
 * unfinished extra vehicles a route change of the main Transfer left
 * untouched. It is zero when the change is not a route change, the Transfer
 * is an extra vehicle, the group has none left, or the same fields were
 * applied to those extra vehicles. The address is not on this object.
 */
export const correctedTransferResultSchema = z.object({
  transfer: transferSchema,
  ride: rideSchema,
  workOrders: z.array(workOrderNoticeSchema),
  relocationWarnings: z.array(relocationWarningSchema),
  // True when the saved window has no free Driver with a free Vehicle and
  // no free Partner. The correction still stands (ADR-0034).
  fullyBooked: z.boolean(),
  unfinishedExtraVehicleCount: z.number().int().nonnegative(),
})

export type CorrectedTransferResult = z.infer<typeof correctedTransferResultSchema>

/**
 * The assign, vehicle-change, clear, or reassign action.
 * `relocationWarnings` names a tight gap. It is empty when the gap is enough.
 * A true overlap is a 409 and is not in this list. Clear leaves the list empty.
 * The address is not on this object.
 */
export const assignedRideSchema = z.object({
  ride: rideSchema,
  workOrders: z.array(workOrderNoticeSchema),
  relocationWarnings: z.array(relocationWarningSchema),
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
