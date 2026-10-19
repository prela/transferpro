import type { PaymentMethod, RideState } from './transfer'
import { z } from 'zod'
import { isCalendarDate, localDayBounds, operationalDateInTimeZone } from './date'
import { landingAlarmOn, rideIsInProgress } from './landing-alarm'
import { OPERATIONAL_DAY_START_DEFAULT, operationalDayStartHourSchema, TRANSFER_DURATION_DEFAULT_MINUTES } from './tenant-settings'
import { PASSENGER_COUNT_MAX, PASSENGER_COUNT_MIN, paymentMethodSchema, rideStateSchema, TABLA_MAX_LENGTH, transferPriceSchema } from './transfer'
import { WORK_ORDER_STATUSES } from './work-order'

/**
 * Four hours, in milliseconds. The unassigned alarm includes this instant
 * and excludes the pickup instant. It is not an acceptance deadline and it
 * does not send mail (ADR-0023).
 */
const UNASSIGNED_ALARM_MS = 4 * 60 * 60 * 1000

/**
 * Sixty minutes, in milliseconds. The unclosed mark includes this instant.
 * It starts at the scheduled pickup, including an earlier day. A recorded
 * landing does not move it. It is not the no-show wait and it sends
 * nothing (ADR-0027).
 */
const UNCLOSED_MARK_MS = 60 * 60 * 1000

/** A decline already read with this Ride. The row stores the Driver id; the name is joined at read. */
export interface OfficeHomeDecline {
  readonly driverName: string
}

/**
 * One Ride the office-home query already read. Names are display text.
 * `driverId` is how "has a Driver" is decided; it is not on the response.
 * `declineAlerts` is empty when nobody declined. The snapshot keeps them
 * only while the Ride is unassigned (ADR-0039).
 */
export interface OfficeHomeRide {
  readonly rideId: string
  readonly pickupAt: string
  readonly guestName: string
  readonly passengerCount: number
  readonly clientName: string
  readonly start: string
  readonly end: string
  readonly state: RideState
  readonly driverId: string | null
  readonly driverName: string | null
  readonly vehiclePlate: string | null
  readonly price: string
  readonly payment: PaymentMethod
  readonly flightNumber: string | null
  readonly landingAt: string | null
  readonly expectedArrival: string | null
  readonly tabla: string
  readonly mustAccept: boolean | null
  readonly declineAlerts?: readonly OfficeHomeDecline[]
}

const officeHomeRowSchema = z.strictObject({
  rideId: z.uuid(),
  pickupAt: z.iso.datetime(),
  guestName: z.string().trim().min(1),
  passengerCount: z.number().int().min(PASSENGER_COUNT_MIN).max(PASSENGER_COUNT_MAX),
  clientName: z.string().trim().min(1),
  start: z.string().trim().min(1),
  end: z.string().trim().min(1),
  state: rideStateSchema,
  driverName: z.string().trim().min(1).nullable(),
  vehiclePlate: z.string().trim().min(1).nullable(),
  price: transferPriceSchema,
  payment: paymentMethodSchema,
  flightNumber: z.string().trim().min(1).nullable(),
  landingAt: z.iso.datetime().nullable(),
  expectedArrival: z.iso.datetime().nullable(),
  tabla: z.string().max(TABLA_MAX_LENGTH),
})

const officeHomeDeclineSchema = z.strictObject({
  driverName: z.string().trim().min(1),
})

const officeHomeUnassignedSchema = officeHomeRowSchema.extend({
  unassignedAlarm: z.boolean(),
  // Pickup is already past. Urgent, and distinct from the four-hour alarm (ADR-0039).
  pastPickup: z.boolean(),
  // Any pickup day. Empty once the Ride is assigned again (ADR-0039).
  declineAlerts: z.array(officeHomeDeclineSchema),
}).strict()

const officeHomeInProgressSchema = officeHomeRowSchema.extend({
  unclosedMark: z.boolean(),
  landingAlarm: z.boolean(),
}).strict()

const officeHomeCountsSchema = z.strictObject({
  rides: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  waitingOnAcceptance: z.number().int().nonnegative(),
  // Assigned or accepted, pickup still ahead, not waiting on acceptance (ADR-0039).
  assignedNotStarted: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  noShow: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
})

/**
 * The three lists and the eight counts from one moment (ADR-0024, ADR-0039).
 * The seven parts add up to `rides`. An unassigned row also carries decline
 * alerts for any pickup day and the past-pickup flag. Waiting has no mark.
 * In progress carries the unclosed mark (ADR-0027) and the landing alarm
 * (ADR-0030). The lists still include a Ride that Home shows only in
 * Pozornost; the blocks below are what the screen renders. There is no
 * week, month, or euro total.
 * `failedMails` sits below Pozornost and outside both attention tiers
 * (ADR-0045). It does not change the urgent count. The Driver's name is
 * derived on read. The address is not a field.
 */
export const officeHomeFailedMailSchema = z.strictObject({
  entryId: z.uuid(),
  driverName: z.string().trim().min(1),
  pickupAt: z.iso.datetime(),
  start: z.string().trim().min(1),
  end: z.string().trim().min(1),
  status: z.enum(WORK_ORDER_STATUSES),
})

export const officeHomeSchema = z.strictObject({
  operationalDate: z.string().refine(isCalendarDate),
  operationalDayStartHour: operationalDayStartHourSchema,
  unassigned: z.array(officeHomeUnassignedSchema),
  waitingOnAcceptance: z.array(officeHomeRowSchema),
  inProgress: z.array(officeHomeInProgressSchema),
  counts: officeHomeCountsSchema,
  failedMails: z.array(officeHomeFailedMailSchema),
})

/** One immediate resend. The address is not on the body. */
export const failedMailResendSchema = z.strictObject({
  outcome: z.enum(['sent', 'stale', 'failed']),
})

export type OfficeHome = z.infer<typeof officeHomeSchema>

/**
 * Urgent items on this read, one key each (ADR-0039). A polite refresh
 * announces a key that was not on the previous read. Past pickup and a
 * decline are urgent. Waiting has none. A Ride can contribute more than
 * one key; Pozornost still shows that Ride once.
 */
export function officeHomeUrgentKeys(home: OfficeHome): string[] {
  const keys: string[] = []
  for (const ride of home.unassigned) {
    if (ride.pastPickup)
      keys.push(`unassigned-past-pickup:${ride.rideId}`)
    else if (ride.unassignedAlarm)
      keys.push(`unassigned-alarm:${ride.rideId}`)
    for (const alert of ride.declineAlerts)
      keys.push(`decline-alert:${ride.rideId}:${alert.driverName}`)
  }
  for (const ride of home.inProgress) {
    if (ride.landingAlarm)
      keys.push(`landing-alarm:${ride.rideId}`)
    if (ride.unclosedMark)
      keys.push(`unclosed-mark:${ride.rideId}`)
  }
  return keys
}

type AttentionList = 'unassigned' | 'waitingOnAcceptance' | 'inProgress'

/**
 * Which list this Ride is on, or none. The three answers are exclusive:
 * unassigned wins, then waiting on acceptance, then in progress.
 * In progress is derived (ADR-0022). A future pickup, a finished Ride,
 * and a Ride with no Driver are not in progress.
 */
function attentionList(ride: OfficeHomeRide, pickup: number, nowMs: number): AttentionList | null {
  if (ride.state === 'unassigned')
    return 'unassigned'
  if (ride.state === 'assigned' && ride.mustAccept === true)
    return 'waitingOnAcceptance'
  if (rideIsInProgress(ride.state, ride.mustAccept, ride.driverId, pickup, nowMs))
    return 'inProgress'
  return null
}

function pickupMillis(pickupAt: string): number {
  const pickup = new Date(pickupAt).getTime()
  if (Number.isNaN(pickup))
    throw new RangeError('Pickup is not a valid time.')
  return pickup
}

function byPickup(a: { pickupAt: string, rideId: string }, b: { pickupAt: string, rideId: string }): number {
  const delta = pickupMillis(a.pickupAt) - pickupMillis(b.pickupAt)
  if (delta !== 0)
    return delta
  if (a.rideId < b.rideId)
    return -1
  if (a.rideId > b.rideId)
    return 1
  return 0
}

/**
 * Build the office snapshot from rides already read at `now`.
 * Lists are every match, soonest pickup first. Counts are the operational
 * day that contains `now`, so a list can be longer than its count.
 * Assigned and not started is counted and is on no list, so the seven
 * parts add up to the total (ADR-0039).
 */
export function buildOfficeHome(
  rides: readonly OfficeHomeRide[],
  now: Date,
  timeZone: string,
  startHour = OPERATIONAL_DAY_START_DEFAULT,
  transferDurationMinutes = TRANSFER_DURATION_DEFAULT_MINUTES,
): OfficeHome {
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Instant is not a valid time.')

  const nowMs = now.getTime()
  const operationalDate = operationalDateInTimeZone(timeZone, now, startHour)
  const bounds = localDayBounds(operationalDate, timeZone, startHour)
  const startMs = bounds.start.getTime()
  const endMs = bounds.end.getTime()

  const unassigned: z.infer<typeof officeHomeUnassignedSchema>[] = []
  const waitingOnAcceptance: z.infer<typeof officeHomeRowSchema>[] = []
  const inProgress: z.infer<typeof officeHomeInProgressSchema>[] = []
  const counts = {
    rides: 0,
    unassigned: 0,
    waitingOnAcceptance: 0,
    assignedNotStarted: 0,
    inProgress: 0,
    done: 0,
    noShow: 0,
    cancelled: 0,
  }

  for (const ride of rides) {
    const pickup = pickupMillis(ride.pickupAt)
    const onDay = pickup >= startMs && pickup < endMs
    const list = attentionList(ride, pickup, nowMs)
    const shown = {
      rideId: ride.rideId,
      pickupAt: new Date(pickup).toISOString(),
      guestName: ride.guestName,
      passengerCount: ride.passengerCount,
      clientName: ride.clientName,
      start: ride.start,
      end: ride.end,
      state: ride.state,
      driverName: ride.driverName,
      vehiclePlate: ride.vehiclePlate,
      price: ride.price,
      payment: ride.payment,
      flightNumber: ride.flightNumber,
      landingAt: ride.landingAt,
      expectedArrival: ride.expectedArrival,
      tabla: ride.tabla,
    }

    if (onDay) {
      counts.rides += 1
      if (list === 'unassigned')
        counts.unassigned += 1
      else if (list === 'waitingOnAcceptance')
        counts.waitingOnAcceptance += 1
      else if (list === 'inProgress')
        counts.inProgress += 1
      else if (ride.state === 'done')
        counts.done += 1
      else if (ride.state === 'no-show')
        counts.noShow += 1
      else if (ride.state === 'cancelled')
        counts.cancelled += 1
      else if (assignedNotStarted(ride, pickup, nowMs))
        counts.assignedNotStarted += 1
    }

    if (list === 'unassigned') {
      unassigned.push({
        ...shown,
        unassignedAlarm: pickup > nowMs && pickup - nowMs <= UNASSIGNED_ALARM_MS,
        pastPickup: pickup < nowMs,
        // A later assignment leaves the stored alert. This list drops it.
        declineAlerts: (ride.declineAlerts ?? []).map(alert => ({ driverName: alert.driverName })),
      })
    }
    else if (list === 'waitingOnAcceptance') {
      waitingOnAcceptance.push(shown)
    }
    else if (list === 'inProgress') {
      inProgress.push({
        ...shown,
        unclosedMark: nowMs - pickup >= UNCLOSED_MARK_MS,
        landingAlarm: landingAlarmOn(ride.landingAt, nowMs, transferDurationMinutes, true),
      })
    }
  }

  unassigned.sort(byPickup)
  waitingOnAcceptance.sort(byPickup)
  inProgress.sort(byPickup)

  return officeHomeSchema.parse({
    operationalDate,
    operationalDayStartHour: startHour,
    unassigned,
    waitingOnAcceptance,
    inProgress,
    counts,
    // The Ride snapshot does not know about mail. The Home read fills this afterwards.
    failedMails: [],
  })
}

/**
 * Assigned or accepted, with a Driver, pickup not yet past, and not waiting
 * on acceptance. The pickup instant itself is included: in progress starts
 * once that instant is past, and this part is what makes the counts add up.
 */
function assignedNotStarted(ride: OfficeHomeRide, pickup: number, nowMs: number): boolean {
  if (ride.driverId === null)
    return false
  if (ride.state === 'done' || ride.state === 'no-show' || ride.state === 'cancelled' || ride.state === 'unassigned')
    return false
  if (ride.state === 'assigned' && ride.mustAccept === true)
    return false
  return pickup >= nowMs
}

/** Urgent kinds Home groups under Pozornost, in the order a Ride is classified. */
export const HOME_ATTENTION_KINDS = [
  'unassigned-past-pickup',
  'unassigned-alarm',
  'decline-alert',
  'landing-alarm',
  'unclosed-mark',
] as const

export type HomeAttentionKind = (typeof HOME_ATTENTION_KINDS)[number]

export interface OfficeHomeMark {
  readonly kind: HomeAttentionKind
  readonly driverName?: string
}

/** One Home row. A Ride with an urgent mark is not also on its list. */
export interface OfficeHomeBlockRide {
  readonly rideId: string
  readonly pickupAt: string
  readonly guestName: string
  readonly passengerCount: number
  readonly clientName: string
  readonly start: string
  readonly end: string
  readonly state: RideState
  readonly driverName: string | null
  readonly vehiclePlate: string | null
  readonly marks: readonly OfficeHomeMark[]
  readonly action: 'assign' | 'accept' | 'done'
}

export interface OfficeHomeAttentionGroup {
  readonly kind: HomeAttentionKind
  readonly rides: readonly OfficeHomeBlockRide[]
}

export interface OfficeHomeBlocks {
  readonly attention: readonly OfficeHomeAttentionGroup[]
  readonly unassigned: readonly OfficeHomeBlockRide[]
  readonly waitingOnAcceptance: readonly OfficeHomeBlockRide[]
  readonly inProgress: readonly OfficeHomeBlockRide[]
}

export const OFFICE_HOME_COUNT_KEYS = [
  'rides',
  'unassigned',
  'waitingOnAcceptance',
  'assignedNotStarted',
  'inProgress',
  'done',
  'noShow',
  'cancelled',
] as const

export type OfficeHomeCountKey = (typeof OFFICE_HOME_COUNT_KEYS)[number]

const COUNT_FILTER: Record<OfficeHomeCountKey, string | null> = {
  rides: null,
  unassigned: 'unassigned',
  waitingOnAcceptance: 'waiting',
  assignedNotStarted: 'assignedNotStarted',
  inProgress: 'inProgress',
  done: 'done',
  noShow: 'noShow',
  cancelled: 'cancelled',
}

/** Transfers for that operational day, with the filter that matches the count. */
export function officeHomeCountPath(date: string, key: OfficeHomeCountKey): string {
  const filter = COUNT_FILTER[key]
  const query = new URLSearchParams({ day: date })
  if (filter)
    query.set('filter', filter)
  return `/transfers?${query.toString()}`
}

/**
 * Where Home shows each Ride from the three lists. Urgent wins, so a Ride
 * is in Pozornost or on its list, never both. Finished Rides and assigned
 * Rides that have not started are counts only.
 */
export function officeHomeBlocks(home: OfficeHome): OfficeHomeBlocks {
  const grouped = new Map<HomeAttentionKind, OfficeHomeBlockRide[]>()
  for (const kind of HOME_ATTENTION_KINDS)
    grouped.set(kind, [])
  const unassigned: OfficeHomeBlockRide[] = []
  const waitingOnAcceptance: OfficeHomeBlockRide[] = []
  const inProgress: OfficeHomeBlockRide[] = []

  for (const row of home.unassigned)
    place(row, unassignedMarks(row), 'assign', unassigned, grouped)
  for (const row of home.waitingOnAcceptance)
    place(row, [], 'accept', waitingOnAcceptance, grouped)
  for (const row of home.inProgress)
    place(row, progressMarks(row), 'done', inProgress, grouped)

  return {
    attention: HOME_ATTENTION_KINDS.flatMap((kind) => {
      const rides = grouped.get(kind) ?? []
      return rides.length > 0 ? [{ kind, rides }] : []
    }),
    unassigned,
    waitingOnAcceptance,
    inProgress,
  }
}

/** Rides in Pozornost. The Početna badge uses this, not the item keys. */
export function officeHomeUrgentRideCount(home: OfficeHome): number {
  return officeHomeBlocks(home).attention.reduce((sum, group) => sum + group.rides.length, 0)
}

function place(
  row: {
    rideId: string
    pickupAt: string
    guestName: string
    passengerCount: number
    clientName: string
    start: string
    end: string
    state: RideState
    driverName: string | null
    vehiclePlate: string | null
  },
  marks: OfficeHomeMark[],
  action: OfficeHomeBlockRide['action'],
  list: OfficeHomeBlockRide[],
  grouped: Map<HomeAttentionKind, OfficeHomeBlockRide[]>,
) {
  const ride: OfficeHomeBlockRide = {
    rideId: row.rideId,
    pickupAt: row.pickupAt,
    guestName: row.guestName,
    passengerCount: row.passengerCount,
    clientName: row.clientName,
    start: row.start,
    end: row.end,
    state: row.state,
    driverName: row.driverName,
    vehiclePlate: row.vehiclePlate,
    marks,
    action,
  }
  const kind = marks[0]?.kind
  if (kind) {
    grouped.get(kind)?.push(ride)
    return
  }
  list.push(ride)
}

function unassignedMarks(row: { pastPickup: boolean, unassignedAlarm: boolean, declineAlerts: readonly { driverName: string }[] }): OfficeHomeMark[] {
  const marks: OfficeHomeMark[] = []
  if (row.pastPickup)
    marks.push({ kind: 'unassigned-past-pickup' })
  else if (row.unassignedAlarm)
    marks.push({ kind: 'unassigned-alarm' })
  for (const alert of row.declineAlerts)
    marks.push({ kind: 'decline-alert', driverName: alert.driverName })
  return marks
}

function progressMarks(row: { landingAlarm: boolean, unclosedMark: boolean }): OfficeHomeMark[] {
  const marks: OfficeHomeMark[] = []
  if (row.landingAlarm)
    marks.push({ kind: 'landing-alarm' })
  if (row.unclosedMark)
    marks.push({ kind: 'unclosed-mark' })
  return marks
}
