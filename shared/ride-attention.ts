import type { RideState } from './transfer'
import { calendarDateInTimeZone, isCalendarDate, operationalDateInTimeZone } from './date'
import { rideIsInProgress } from './landing-alarm'
import { UNCLOSED_MARK_MS } from './unclosed-mark'

/**
 * Four hours, in milliseconds. The unassigned alarm includes this instant
 * and excludes the pickup instant (ADR-0023). Same bound as the office home.
 */
const UNASSIGNED_ALARM_MS = 4 * 60 * 60 * 1000

export const RIDE_ATTENTION_KINDS = [
  'unassigned-past-pickup',
  'unassigned-alarm',
  'decline-alert',
  'landing-alarm',
  'unclosed-mark',
  'overlap',
  'unavailable',
  'roster-mismatch',
  'expired-document',
] as const

export type RideAttentionKind = (typeof RIDE_ATTENTION_KINDS)[number]

export type RideAttentionTier = 'urgent' | 'warning'

export interface RideAttentionItem {
  readonly tier: RideAttentionTier
  readonly kind: RideAttentionKind
  /** Set on a decline. The name was joined when the day was read. */
  readonly driverName?: string
}

/** What the day row already knows. Warnings stay as the day read derived them. */
export interface RideAttentionSource {
  readonly state: RideState
  readonly pickupAt: string
  readonly driverId: string | null
  readonly mustAccept: boolean | null
  readonly landingAlarm: boolean
  readonly warnings: {
    readonly expiredDocuments: readonly string[]
    readonly rosterMismatch: boolean
    readonly overlappingRideIds: readonly string[]
    /** The Driver or Vehicle an unavailability window covers. Absent when none is. */
    readonly unavailable?: readonly string[]
  }
}

export interface RideDecline {
  readonly driverName: string
}

const URGENT = new Set<RideAttentionKind>([
  'unassigned-past-pickup',
  'unassigned-alarm',
  'decline-alert',
  'landing-alarm',
  'unclosed-mark',
])

export function rideAttentionTier(kind: RideAttentionKind): RideAttentionTier {
  return URGENT.has(kind) ? 'urgent' : 'warning'
}

function pickupMillis(pickupAt: string): number {
  const pickup = new Date(pickupAt).getTime()
  if (Number.isNaN(pickup))
    throw new RangeError('Pickup is not a valid time.')
  return pickup
}

/**
 * Urgent items and warnings for one Ride, in a stable order.
 * An unassigned past pickup and the four-hour alarm do not both apply.
 * A short gap and a true overlap are one warning, as the day read already
 * folded them into `overlappingRideIds`.
 */
export function classifyRideAttention(
  ride: RideAttentionSource,
  declines: readonly RideDecline[],
  nowMs: number,
): RideAttentionItem[] {
  const pickup = pickupMillis(ride.pickupAt)
  const items: RideAttentionItem[] = []

  if (ride.state === 'unassigned' && pickup < nowMs)
    items.push({ tier: 'urgent', kind: 'unassigned-past-pickup' })
  else if (ride.state === 'unassigned' && pickup > nowMs && pickup - nowMs <= UNASSIGNED_ALARM_MS)
    items.push({ tier: 'urgent', kind: 'unassigned-alarm' })

  for (const decline of declines)
    items.push({ tier: 'urgent', kind: 'decline-alert', driverName: decline.driverName })

  if (ride.landingAlarm)
    items.push({ tier: 'urgent', kind: 'landing-alarm' })

  const inProgress = rideIsInProgress(ride.state, ride.mustAccept, ride.driverId, pickup, nowMs)
  // A handed-off Ride is not in progress. It takes the same mark, from the
  // same instant, so a Partner Ride nobody closes is not forgotten (ADR-0048).
  const unclosed = inProgress || ride.state === 'handed_off'
  if (unclosed && nowMs - pickup >= UNCLOSED_MARK_MS)
    items.push({ tier: 'urgent', kind: 'unclosed-mark' })

  if (ride.warnings.overlappingRideIds.length > 0)
    items.push({ tier: 'warning', kind: 'overlap' })
  if ((ride.warnings.unavailable?.length ?? 0) > 0)
    items.push({ tier: 'warning', kind: 'unavailable' })
  if (ride.warnings.rosterMismatch)
    items.push({ tier: 'warning', kind: 'roster-mismatch' })
  if (ride.warnings.expiredDocuments.length > 0)
    items.push({ tier: 'warning', kind: 'expired-document' })

  return items
}

/** Keys a polite refresh announces. One per urgent item, in classification order. */
export function rideUrgentKeys(rideId: string, items: readonly RideAttentionItem[]): string[] {
  return items
    .filter(item => item.tier === 'urgent')
    .map(item => item.kind === 'decline-alert'
      ? `decline-alert:${rideId}:${item.driverName ?? ''}`
      : `${item.kind}:${rideId}`)
}

export const TRANSFER_DAY_FILTERS = [
  'all',
  'urgent',
  'warnings',
  'unassigned',
  'waiting',
  'inProgress',
  'closed',
] as const

export type TransferDayFilter = (typeof TRANSFER_DAY_FILTERS)[number]

/**
 * Toolbar chips stay the seven in ADR-0038. Home's balance also links to
 * the part that has no chip: assigned and not started, and each finished state.
 */
export type TransferBoardFilter = TransferDayFilter | 'assignedNotStarted' | 'handedOff' | 'done' | 'noShow' | 'cancelled'

const CLOSED = new Set<RideState>(['done', 'no-show', 'cancelled'])

const HOME_PART_FILTERS = ['assignedNotStarted', 'handedOff', 'done', 'noShow', 'cancelled'] as const

export function parseTransferDayFilter(value: unknown): TransferBoardFilter {
  if (typeof value === 'string' && (HOME_PART_FILTERS as readonly string[]).includes(value))
    return value as TransferBoardFilter
  if (typeof value === 'string' && (TRANSFER_DAY_FILTERS as readonly string[]).includes(value))
    return value as TransferDayFilter
  return 'all'
}

function waitingOnAcceptance(ride: RideAttentionSource): boolean {
  return ride.state === 'assigned' && ride.mustAccept === true
}

export function transferDayFilterMatches(
  filter: TransferBoardFilter,
  ride: RideAttentionSource,
  declines: readonly RideDecline[],
  nowMs: number,
): boolean {
  if (filter === 'all')
    return true
  const items = classifyRideAttention(ride, declines, nowMs)
  if (filter === 'urgent')
    return items.some(item => item.tier === 'urgent')
  if (filter === 'warnings')
    return items.some(item => item.tier === 'warning')
  if (filter === 'unassigned')
    return ride.state === 'unassigned'
  if (filter === 'waiting')
    return waitingOnAcceptance(ride)
  if (filter === 'inProgress')
    return rideIsInProgress(ride.state, ride.mustAccept, ride.driverId, pickupMillis(ride.pickupAt), nowMs)
  if (filter === 'assignedNotStarted')
    return assignedNotStarted(ride, nowMs)
  if (filter === 'handedOff')
    return ride.state === 'handed_off'
  if (filter === 'done')
    return ride.state === 'done'
  if (filter === 'noShow')
    return ride.state === 'no-show'
  if (filter === 'cancelled')
    return ride.state === 'cancelled'
  return CLOSED.has(ride.state)
}

/** The Home count of the same name. Pickup at `now` has not started yet. */
function assignedNotStarted(ride: RideAttentionSource, nowMs: number): boolean {
  if (ride.state === 'unassigned' || ride.driverId === null || waitingOnAcceptance(ride) || CLOSED.has(ride.state))
    return false
  return pickupMillis(ride.pickupAt) >= nowMs
}

export interface TransferDayFilterRide {
  readonly rideId: string
  readonly ride: RideAttentionSource
  readonly declines?: readonly RideDecline[]
}

export function transferDayFilterCounts(
  rides: readonly TransferDayFilterRide[],
  nowMs: number,
): Record<TransferDayFilter, number> {
  const counts = {
    all: 0,
    urgent: 0,
    warnings: 0,
    unassigned: 0,
    waiting: 0,
    inProgress: 0,
    closed: 0,
  }
  for (const row of rides) {
    const declines = row.declines ?? []
    for (const filter of TRANSFER_DAY_FILTERS) {
      if (transferDayFilterMatches(filter, row.ride, declines, nowMs))
        counts[filter] += 1
    }
  }
  return counts
}

export interface RideStateMark {
  readonly key: 'unassigned' | 'waiting' | 'assigned' | 'accepted' | 'handedOff' | 'inProgress' | 'done' | 'noShow' | 'cancelled'
  readonly color: 'warning' | 'neutral' | 'primary' | 'info' | 'success' | 'error'
  readonly variant: 'subtle' | 'outline'
  readonly muted: boolean
}

/**
 * Icon, text, and colour for the state column (ADR-0040). In progress wins
 * over assigned and accepted once the pickup is past. Finished rows are muted.
 */
export function rideStateMark(ride: RideAttentionSource, nowMs: number): RideStateMark {
  if (ride.state === 'done')
    return { key: 'done', color: 'success', variant: 'subtle', muted: true }
  if (ride.state === 'no-show')
    return { key: 'noShow', color: 'error', variant: 'outline', muted: true }
  if (ride.state === 'cancelled')
    return { key: 'cancelled', color: 'neutral', variant: 'subtle', muted: true }
  if (ride.state === 'unassigned')
    return { key: 'unassigned', color: 'warning', variant: 'outline', muted: false }
  if (ride.state === 'handed_off')
    return { key: 'handedOff', color: 'neutral', variant: 'outline', muted: false }
  if (waitingOnAcceptance(ride))
    return { key: 'waiting', color: 'warning', variant: 'outline', muted: false }
  const pickup = pickupMillis(ride.pickupAt)
  if (rideIsInProgress(ride.state, ride.mustAccept, ride.driverId, pickup, nowMs))
    return { key: 'inProgress', color: 'info', variant: 'subtle', muted: false }
  if (ride.state === 'accepted')
    return { key: 'accepted', color: 'primary', variant: 'subtle', muted: false }
  return { key: 'assigned', color: 'neutral', variant: 'subtle', muted: false }
}

/**
 * The time cell names the calendar date when it is not the operational day
 * on screen. That is the part of the day after midnight.
 */
export function pickupNeedsCalendarDate(pickupAt: string, day: string, timeZone: string): boolean {
  if (!isCalendarDate(day))
    return false
  return calendarDateInTimeZone(timeZone, new Date(pickupAt)) !== day
}

/**
 * Home lists Rides from other operational days. The clock is enough on the
 * day the screen is showing, including the part after midnight. A pickup
 * before the start hour belongs to the previous operational day even when
 * the calendar date matches, so that row names the date too.
 */
export function homeRowNamesTheDate(
  pickupAt: string,
  operationalDate: string,
  timeZone: string,
  operationalDayStartHour: number,
): boolean {
  if (pickupNeedsCalendarDate(pickupAt, operationalDate, timeZone))
    return true
  if (!isCalendarDate(operationalDate))
    return false
  return operationalDateInTimeZone(timeZone, new Date(pickupAt), operationalDayStartHour) !== operationalDate
}
