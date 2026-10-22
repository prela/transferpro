import { z } from 'zod'
import { addCalendarDays, instantFromWallClock, isCalendarDate, mondayOfWeek, wallClockInTimeZone } from './date'

/**
 * Unavailability windows (Nedostupnost, ADR-0034). The office marks a
 * Driver, a Vehicle, or a Partner away from one instant to a later one.
 * A window is half-open, `[startsAt, endsAt)`, like the occupied window.
 * It has no reason and no kind, so no health or private detail is ever
 * stored. Instants travel as UTC ISO text. The Tenant time zone is display
 * only, and the whole-day shortcut turns calendar days into instants in it.
 */

/**
 * The only field names an audit entry for a window may store. The instants
 * stay on the window: the audit row is never deleted, and it must not say
 * when someone was away.
 */
export const UNAVAILABILITY_FIELDS = ['startsAt', 'endsAt', 'removed'] as const

export const unavailabilityFieldSchema = z.enum(UNAVAILABILITY_FIELDS)

export type UnavailabilityField = z.infer<typeof unavailabilityFieldSchema>

/** One window as the office reads it. Exactly one of the three ids is set. */
export const unavailabilityWindowSchema = z.object({
  id: z.uuid(),
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  partnerId: z.uuid().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
}).refine(window => [window.driverId, window.vehicleId, window.partnerId].filter(id => id !== null).length === 1)

export type UnavailabilityWindowView = z.infer<typeof unavailabilityWindowSchema>

/** GET per Driver, per Vehicle, per Partner, or per roster week. A removed window is not listed. */
export const unavailabilityListSchema = z.object({
  windows: z.array(unavailabilityWindowSchema),
})

export type UnavailabilityList = z.infer<typeof unavailabilityListSchema>

/** An assigned, accepted, or handed-off Ride the saved window now covers. The guest and the place stay off. */
export const coveredRideSchema = z.object({
  rideId: z.uuid(),
  pickupAt: z.iso.datetime(),
})

export type CoveredRide = z.infer<typeof coveredRideSchema>

/** A window was added or changed. The covered Rides still save and show the warning on the board. */
export const unavailabilitySavedSchema = z.object({
  window: unavailabilityWindowSchema,
  coveredRides: z.array(coveredRideSchema),
})

export type UnavailabilitySaved = z.infer<typeof unavailabilitySavedSchema>

/** The body, the id, or the week was not a window. Nothing is written. */
export class UnavailabilityInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'UnavailabilityInputError'
  }
}

/** Either side of a window. An offset is allowed and dropped: the stored value is the instant. */
const instantText = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString())

function startsBeforeEnd(times: { readonly startsAt: string, readonly endsAt: string }): boolean {
  return Date.parse(times.startsAt) < Date.parse(times.endsAt)
}

/** No `reason` and no `kind` key: an unknown key is refused (ADR-0034). */
const recordUnavailabilitySchema = z.strictObject({
  driverId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  partnerId: z.uuid().optional(),
  startsAt: instantText,
  endsAt: instantText,
})
  .refine(body => [body.driverId, body.vehicleId, body.partnerId].filter(id => id !== undefined).length === 1)
  .refine(startsBeforeEnd)

const changeUnavailabilitySchema = z.strictObject({
  startsAt: instantText,
  endsAt: instantText,
}).refine(startsBeforeEnd)

export type UnavailabilityResource
  = { readonly kind: 'driver', readonly id: string }
    | { readonly kind: 'vehicle', readonly id: string }
    | { readonly kind: 'partner', readonly id: string }

export interface RecordUnavailability {
  readonly resource: UnavailabilityResource
  readonly startsAt: string
  readonly endsAt: string
}

export interface ChangeUnavailability {
  readonly windowId: string
  readonly startsAt: string
  readonly endsAt: string
}

/** A new window for one Driver, one Vehicle, or one Partner. A bad body throws first, so no session opens. */
export function parseRecordUnavailability(raw: unknown): RecordUnavailability {
  const parsed = recordUnavailabilitySchema.safeParse(raw)
  if (!parsed.success)
    throw new UnavailabilityInputError()
  const { driverId, vehicleId, partnerId, startsAt, endsAt } = parsed.data
  const resource: UnavailabilityResource = driverId !== undefined
    ? { kind: 'driver', id: driverId }
    : vehicleId !== undefined
      ? { kind: 'vehicle', id: vehicleId }
      : { kind: 'partner', id: partnerId as string }
  return { resource, startsAt, endsAt }
}

/** New instants for one window. The Driver or Vehicle of a window does not change. */
export function parseChangeUnavailability(rawWindowId: unknown, raw: unknown): ChangeUnavailability {
  const windowId = parseUnavailabilityId(rawWindowId)
  const parsed = changeUnavailabilitySchema.safeParse(raw)
  if (!parsed.success)
    throw new UnavailabilityInputError()
  return { windowId, ...parsed.data }
}

/** A window id from the path. */
export function parseUnavailabilityId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw new UnavailabilityInputError()
  return parsed.data
}

/** A Driver or Vehicle id from the path. */
export function parseUnavailabilityResourceId(raw: unknown): string {
  return parseUnavailabilityId(raw)
}

/** The `week` query: the Monday that starts the roster week. */
export function parseUnavailabilityWeek(raw: unknown): string {
  if (typeof raw !== 'string' || !isCalendarDate(raw) || mondayOfWeek(raw) !== raw)
    throw new UnavailabilityInputError()
  return raw
}

function localMidnight(day: string, timeZone: string): Date {
  return instantFromWallClock(`${day}T00:00`, timeZone)
}

/**
 * The whole-day shortcut: from local midnight of `fromDay` to the local
 * midnight after `toDay`, in the Tenant time zone. A day of 23 or 25 hours
 * stays one whole day.
 */
export function wholeDaysWindow(fromDay: string, toDay: string, timeZone: string): { startsAt: Date, endsAt: Date } {
  if (!isCalendarDate(fromDay) || !isCalendarDate(toDay) || toDay < fromDay)
    throw new RangeError('Whole days run from one calendar date to the same or a later one.')
  return {
    startsAt: localMidnight(fromDay, timeZone),
    endsAt: localMidnight(addCalendarDays(toDay, 1), timeZone),
  }
}

/**
 * The inverse of {@link wholeDaysWindow}: the first and last local day when
 * both ends fall on local midnight, else null. The list shows such a window
 * as days, and the edit form reopens it with the whole-day shortcut on.
 */
export function wholeDaysOf(
  window: { readonly startsAt: string, readonly endsAt: string },
  timeZone: string,
): { fromDay: string, toDay: string } | null {
  const start = wallClockInTimeZone(timeZone, new Date(window.startsAt))
  const end = wallClockInTimeZone(timeZone, new Date(window.endsAt))
  if (!start.endsWith('T00:00') || !end.endsWith('T00:00'))
    return null
  const fromDay = start.slice(0, 10)
  const toDay = addCalendarDays(end.slice(0, 10), -1)
  return toDay < fromDay ? null : { fromDay, toDay }
}

/** The roster week read: seven local days from its Monday, half-open. */
export function unavailabilityWeekRange(monday: string, timeZone: string): { from: Date, to: Date } {
  const days = wholeDaysWindow(monday, addCalendarDays(monday, 6), timeZone)
  return { from: days.startsAt, to: days.endsAt }
}

/** The capacity refusals that `confirm: true` passes (ADR-0029, ADR-0034). */
export type CapacityConfirmReason = 'overlap' | 'unavailable'

/**
 * Which refusal the confirmation dialog names. `ride_unavailable` wins when
 * an overlap also applies, and the one confirmation passes both. Every other
 * code is not confirmable.
 */
export function capacityConfirmReason(code: string | undefined): CapacityConfirmReason | null {
  if (code === 'ride_overlap')
    return 'overlap'
  if (code === 'ride_unavailable')
    return 'unavailable'
  return null
}

/**
 * Which capacity refusal the dialog names, including Popunjeno, which
 * cannot be confirmed. `fullyBooked` is not in
 * {@link CapacityConfirmReason}: the dialog offers no confirmation, and
 * `confirm` does not pass 409 `fully_booked` (ADR-0034).
 */
export type CapacityRefusalReason = CapacityConfirmReason | 'fullyBooked'

export function capacityDialogReason(code: string | undefined): CapacityRefusalReason | null {
  const confirmable = capacityConfirmReason(code)
  if (confirmable)
    return confirmable
  if (code === 'fully_booked')
    return 'fullyBooked'
  return null
}

/** Whether any part of the window falls on this local calendar date. The roster grid shows it there. */
export function windowTouchesDate(
  window: { readonly startsAt: string, readonly endsAt: string },
  day: string,
  timeZone: string,
): boolean {
  const bounds = wholeDaysWindow(day, day, timeZone)
  return Date.parse(window.startsAt) < bounds.endsAt.getTime() && bounds.startsAt.getTime() < Date.parse(window.endsAt)
}
