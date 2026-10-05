import { z } from 'zod'
import { isCalendarDate } from './date'

/**
 * A roster day is a calendar date, `YYYY-MM-DD`, with no time and no zone.
 * The Tenant time zone is used only to decide which day "today" is.
 */
export const rosterDateSchema = z.string().refine(isCalendarDate)

const driverIdSchema = z.uuid()
const vehicleIdSchema = z.uuid()

/** One Driver's Vehicle on one day. The plate and the name stay off this object. */
export const rosterAssignmentSchema = z.object({
  driverId: driverIdSchema,
  vehicleId: vehicleIdSchema,
})

export type RosterAssignment = z.infer<typeof rosterAssignmentSchema>

/** GET /api/roster?date=. An empty list is a day with no assignments. */
export const rosterDaySchema = z.object({
  rosterDate: rosterDateSchema,
  assignments: z.array(rosterAssignmentSchema),
})

export type RosterDay = z.infer<typeof rosterDaySchema>

/**
 * PUT /api/roster. `vehicleId` null clears that Driver's row for the day.
 * An unknown key is refused, so a plate or a name cannot ride along.
 */
export const setRosterSchema = z.strictObject({
  rosterDate: rosterDateSchema,
  driverId: driverIdSchema,
  vehicleId: vehicleIdSchema.nullable(),
})

export type SetRoster = z.infer<typeof setRosterSchema>

/** PUT /api/roster. Null is a day that no longer has a row for that Driver. */
export const setRosterResultSchema = z.object({
  assignment: rosterAssignmentSchema.nullable(),
})

export type SetRosterResult = z.infer<typeof setRosterResultSchema>

/** The body or the date query was not a roster day. Nothing is written. */
export class RosterInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'RosterInputError'
  }
}

/** The `date` query. Anything but one calendar date is refused before a session opens. */
export function parseRosterDate(raw: unknown): string {
  if (typeof raw !== 'string' || !isCalendarDate(raw))
    throw new RosterInputError()
  return raw
}

/** Accepts one assignment or a clear. Any other body throws first, so the caller does not open a session. */
export function parseSetRoster(raw: unknown): SetRoster {
  const parsed = setRosterSchema.safeParse(raw)
  if (!parsed.success)
    throw new RosterInputError()
  return parsed.data
}

/**
 * The calendar date of `instant` in an IANA time zone.
 * Used to open the roster on "today" in the Tenant zone. The roster stores
 * that date, not the instant.
 */
export function calendarDateInTimeZone(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).formatToParts(instant)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  const date = `${year}-${month}-${day}`
  if (!isCalendarDate(date))
    throw new Error('Calendar date could not be read.')
  return date
}
