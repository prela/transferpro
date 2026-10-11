import type { PaymentMethod, RideState } from './transfer'
import { z } from 'zod'
import { localDayBounds, operationalDateInTimeZone } from './date'
import { OPERATIONAL_DAY_START_DEFAULT } from './tenant-settings'
import { paymentMethodSchema, rideStateSchema, TABLA_MAX_LENGTH, transferPriceSchema } from './transfer'

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

/**
 * One Ride the office-home query already read. Names are display text.
 * `driverId` is how "has a Driver" is decided; it is not on the response.
 */
export interface OfficeHomeRide {
  readonly rideId: string
  readonly pickupAt: string
  readonly guestName: string
  readonly start: string
  readonly end: string
  readonly state: RideState
  readonly driverId: string | null
  readonly driverName: string | null
  readonly vehiclePlate: string | null
  readonly price: string
  readonly payment: PaymentMethod
  readonly flightNumber: string | null
  readonly tabla: string
  readonly mustAccept: boolean | null
}

const officeHomeRowSchema = z.strictObject({
  rideId: z.uuid(),
  pickupAt: z.iso.datetime(),
  guestName: z.string().trim().min(1),
  start: z.string().trim().min(1),
  end: z.string().trim().min(1),
  state: rideStateSchema,
  driverName: z.string().trim().min(1).nullable(),
  vehiclePlate: z.string().trim().min(1).nullable(),
  price: transferPriceSchema,
  payment: paymentMethodSchema,
  flightNumber: z.string().trim().min(1).nullable(),
  tabla: z.string().max(TABLA_MAX_LENGTH),
})

const officeHomeUnassignedSchema = officeHomeRowSchema.extend({
  unassignedAlarm: z.boolean(),
}).strict()

const officeHomeInProgressSchema = officeHomeRowSchema.extend({
  unclosedMark: z.boolean(),
}).strict()

const officeHomeCountsSchema = z.strictObject({
  rides: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  waitingOnAcceptance: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  noShow: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
})

/**
 * The three lists and the seven counts from one moment (ADR-0024).
 * Waiting has no mark. In progress carries the unclosed mark (ADR-0027).
 * There is no week, month, or euro total.
 */
export const officeHomeSchema = z.strictObject({
  unassigned: z.array(officeHomeUnassignedSchema),
  waitingOnAcceptance: z.array(officeHomeRowSchema),
  inProgress: z.array(officeHomeInProgressSchema),
  counts: officeHomeCountsSchema,
})

export type OfficeHome = z.infer<typeof officeHomeSchema>

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
  const finished = ride.state === 'done' || ride.state === 'no-show' || ride.state === 'cancelled'
  if (!finished && ride.driverId !== null && pickup < nowMs)
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
 * A Ride that is only assigned, does not require acceptance, and is still
 * ahead is in the Rides count and on no list.
 */
export function buildOfficeHome(
  rides: readonly OfficeHomeRide[],
  now: Date,
  timeZone: string,
  startHour = OPERATIONAL_DAY_START_DEFAULT,
): OfficeHome {
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Instant is not a valid time.')

  const nowMs = now.getTime()
  const bounds = localDayBounds(operationalDateInTimeZone(timeZone, now, startHour), timeZone, startHour)
  const startMs = bounds.start.getTime()
  const endMs = bounds.end.getTime()

  const unassigned: z.infer<typeof officeHomeUnassignedSchema>[] = []
  const waitingOnAcceptance: z.infer<typeof officeHomeRowSchema>[] = []
  const inProgress: z.infer<typeof officeHomeInProgressSchema>[] = []
  const counts = {
    rides: 0,
    unassigned: 0,
    waitingOnAcceptance: 0,
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
      start: ride.start,
      end: ride.end,
      state: ride.state,
      driverName: ride.driverName,
      vehiclePlate: ride.vehiclePlate,
      price: ride.price,
      payment: ride.payment,
      flightNumber: ride.flightNumber,
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
    }

    if (list === 'unassigned') {
      unassigned.push({
        ...shown,
        unassignedAlarm: pickup > nowMs && pickup - nowMs <= UNASSIGNED_ALARM_MS,
      })
    }
    else if (list === 'waitingOnAcceptance') {
      waitingOnAcceptance.push(shown)
    }
    else if (list === 'inProgress') {
      inProgress.push({
        ...shown,
        unclosedMark: nowMs - pickup >= UNCLOSED_MARK_MS,
      })
    }
  }

  unassigned.sort(byPickup)
  waitingOnAcceptance.sort(byPickup)
  inProgress.sort(byPickup)

  return officeHomeSchema.parse({
    unassigned,
    waitingOnAcceptance,
    inProgress,
    counts,
  })
}
