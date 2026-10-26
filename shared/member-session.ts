import type { TenantRole } from './tenant-role'
import type { RideState } from './transfer'
import { operationalDateInTimeZone } from './date'
import { rideIsInProgress } from './ride-attention'

/**
 * Twelve hours from sign-in (ADR-0057). An Admin or a Dispatcher ends here.
 * A Driver without a holding Ride is refused here too. The database trigger
 * uses `interval '12 hours'`, the same length.
 */
export const OFFICE_SESSION_MS = 12 * 60 * 60 * 1000

/**
 * Sixteen hours from sign-in. A Driver row may live this long so a holding
 * Ride can still be seen after twelve hours. The session is refused at
 * sixteen hours even during that Ride. The database trigger uses
 * `interval '16 hours'`.
 */
export const DRIVER_HELD_SESSION_MS = 16 * 60 * 60 * 1000

/** The open office screen, not the session row. A live refresh does not move it. */
export const OFFICE_IDLE_MS = 30 * 60 * 1000

/** The office warning. It does not sign them out. */
export const OFFICE_WARNING_LEAD_MS = 15 * 60 * 1000

/** The driver banners. Neither blocks the screen. */
export const DRIVER_WARNING_LEAD_MS = 30 * 60 * 1000

/**
 * The cap of the active membership, measured from this sign-in.
 * A holding Ride is the only reason a Driver passes twelve hours.
 */
export function memberSessionCapMs(role: TenantRole, holdingRide: boolean): number {
  if (role === 'driver' && holdingRide)
    return DRIVER_HELD_SESSION_MS
  return OFFICE_SESSION_MS
}

export interface HoldingRideFacts {
  readonly state: RideState
  readonly mustAccept: boolean | null
  readonly driverId: string | null
  readonly pickupAt: Date
  readonly timeZone: string
  readonly operationalDayStartHour: number
}

/**
 * In progress, and the pickup is on the current operational day (ADR-0057).
 * An earlier day's unclosed Ride, a future pickup, and a Ride still waiting
 * on acceptance do not hold the session.
 */
export function rideHoldsDriverSession(ride: HoldingRideFacts, now: Date): boolean {
  if (!rideIsInProgress(ride.state, ride.mustAccept, ride.driverId, ride.pickupAt.getTime(), now.getTime()))
    return false
  const start = ride.operationalDayStartHour
  return operationalDateInTimeZone(ride.timeZone, ride.pickupAt, start)
    === operationalDateInTimeZone(ride.timeZone, now, start)
}

/** Shown before the twelve-hour office end. False once that end has arrived. */
export function officeSessionWarning(signedInAt: Date, now: Date): boolean {
  const end = signedInAt.getTime() + OFFICE_SESSION_MS
  const at = now.getTime()
  return at >= end - OFFICE_WARNING_LEAD_MS && at < end
}

/**
 * `ending` is the plain twelve-hour warning.
 * `held` is that same moment while a Ride is keeping the session open.
 * `cap` is the sixteen-hour warning. It is absent when the Ride has already ended.
 */
export type DriverSessionBanner = 'ending' | 'held' | 'cap'

export function driverSessionBanners(signedInAt: Date, now: Date, holdingRide: boolean): DriverSessionBanner[] {
  const start = signedInAt.getTime()
  const at = now.getTime()
  const twelve = start + OFFICE_SESSION_MS
  const sixteen = start + DRIVER_HELD_SESSION_MS
  if (holdingRide) {
    if (at < twelve - DRIVER_WARNING_LEAD_MS || at >= sixteen)
      return []
    const banners: DriverSessionBanner[] = ['held']
    if (at >= sixteen - DRIVER_WARNING_LEAD_MS)
      banners.push('cap')
    return banners
  }
  if (at >= twelve - DRIVER_WARNING_LEAD_MS && at < twelve)
    return ['ending']
  return []
}

/**
 * The office idle clock for one tab.
 * A hidden tab is not a person's action (`sharedIdleAfterAction`).
 * A live refresh is not one either, so only `reset` moves the mark.
 */
export interface OfficeIdleClock {
  due: (at: number) => boolean
  /** Milliseconds until idle. Starting the timer over must use this, or a fresh wait grants another half hour. */
  remaining: (at: number) => number
  /** Replace the mark. A shared stamp from another tab may be earlier or later. */
  reset: (at: number) => void
}

export function createOfficeIdleClock(startedAt: number): OfficeIdleClock {
  let lastActionAt = startedAt
  return {
    due(at) {
      return at - lastActionAt >= OFFICE_IDLE_MS
    },
    remaining(at) {
      return Math.max(0, lastActionAt + OFFICE_IDLE_MS - at)
    },
    reset(at) {
      lastActionAt = at
    },
  }
}

/** One idle mark for every tab of this browser (ADR-0057). */
export const OFFICE_IDLE_STORAGE_KEY = 'transferpro-office-idle'

/** Written when idle signs the browser out, so the other tabs follow. */
export const OFFICE_IDLE_END_KEY = 'transferpro-office-idle-end'

/** Same-origin tabs hear a mark or an end without waiting for a poll. */
export const OFFICE_IDLE_CHANNEL = 'transferpro-office-idle'

export interface SharedOfficeIdle {
  readonly signedInAt: string
  readonly lastActionAt: number
}

export interface SharedOfficeIdleEnd {
  readonly signedInAt: string
}

export type OfficeIdleMessage
  = | { kind: 'action', signedInAt: string, lastActionAt: number }
    | { kind: 'end', signedInAt: string }

function idleStamp(value: unknown): { signedInAt: string, lastActionAt?: number } | null {
  if (typeof value !== 'object' || value === null)
    return null
  if (!('signedInAt' in value) || typeof value.signedInAt !== 'string' || value.signedInAt === '')
    return null
  if (!('lastActionAt' in value))
    return { signedInAt: value.signedInAt }
  if (typeof value.lastActionAt !== 'number' || !Number.isFinite(value.lastActionAt))
    return null
  return { signedInAt: value.signedInAt, lastActionAt: value.lastActionAt }
}

export function readSharedOfficeIdle(raw: string | null): SharedOfficeIdle | null {
  if (raw === null)
    return null
  try {
    const parsed = idleStamp(JSON.parse(raw))
    if (parsed?.lastActionAt === undefined)
      return null
    return { signedInAt: parsed.signedInAt, lastActionAt: parsed.lastActionAt }
  }
  catch {
    return null
  }
}

export function readSharedOfficeIdleEnd(raw: string | null): SharedOfficeIdleEnd | null {
  if (raw === null)
    return null
  try {
    const parsed = idleStamp(JSON.parse(raw))
    if (parsed === null)
      return null
    return { signedInAt: parsed.signedInAt }
  }
  catch {
    return null
  }
}

/**
 * Opening another tab keeps the mark for this sign-in.
 * A different sign-in starts at `at`. That start is not a person's action.
 */
export function sharedIdleForSession(current: SharedOfficeIdle | null, signedInAt: string, at: number): SharedOfficeIdle {
  if (current?.signedInAt === signedInAt)
    return current
  return { signedInAt, lastActionAt: at }
}

/**
 * A visible key, click, or command moves the shared mark forward.
 * A hidden tab, a live refresh, and an older stamp do not.
 * Null means the caller must not write.
 */
export function sharedIdleAfterAction(current: SharedOfficeIdle, at: number, visible: boolean): SharedOfficeIdle | null {
  if (!visible || at <= current.lastActionAt)
    return null
  return { signedInAt: current.signedInAt, lastActionAt: at }
}

/** The three storage calls the idle clock makes. Null means the browser blocked storage. */
export interface OfficeIdleStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/**
 * Other tabs of this browser. When there is no channel, every method
 * does nothing and the storage event plus the 60s poll still run.
 */
export interface OfficeIdleChannel {
  postMessage: (message: OfficeIdleMessage) => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  close: () => void
}

interface OfficeIdleChannelPort {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  close: () => void
}

/** `BroadcastChannel`, or a stand-in whose constructor throws. */
export type OfficeIdleChannelFactory = new (name: string) => OfficeIdleChannelPort

/**
 * A throw is "no shared mark". Privacy mode and a disabled site store do this.
 */
export function readOfficeIdleMark(storage: OfficeIdleStorage | null): SharedOfficeIdle | null {
  if (storage === null)
    return null
  try {
    return readSharedOfficeIdle(storage.getItem(OFFICE_IDLE_STORAGE_KEY))
  }
  catch {
    return null
  }
}

/** A throw is "no shared end". This tab decides its own sign-out. */
export function readOfficeIdleEndMark(storage: OfficeIdleStorage | null): SharedOfficeIdleEnd | null {
  if (storage === null)
    return null
  try {
    return readSharedOfficeIdleEnd(storage.getItem(OFFICE_IDLE_END_KEY))
  }
  catch {
    return null
  }
}

/** A throw is skipped. Clearing the end stamp is only for the other tabs. */
export function clearOfficeIdleEnd(storage: OfficeIdleStorage | null): void {
  if (storage === null)
    return
  try {
    storage.removeItem(OFFICE_IDLE_END_KEY)
  }
  catch {
    // This tab still signs out. The other tabs will not hear a blocked store.
  }
}

function writeOfficeIdleRaw(storage: OfficeIdleStorage | null, key: string, value: string): void {
  if (storage === null)
    return
  try {
    storage.setItem(key, value)
  }
  catch {
    // Quota or a blocked store. The caller still applies the mark on this tab.
  }
}

function postOfficeIdle(channel: OfficeIdleChannel, message: OfficeIdleMessage): void {
  try {
    channel.postMessage(message)
  }
  catch {
    // A closed channel matches no channel. The storage event and the poll remain.
  }
}

/**
 * Share the mark, then hand it back so this tab can apply it.
 * The write is best-effort: a throw still returns `record`.
 */
export function publishOfficeIdleMark(
  storage: OfficeIdleStorage | null,
  channel: OfficeIdleChannel,
  record: SharedOfficeIdle,
): SharedOfficeIdle {
  writeOfficeIdleRaw(storage, OFFICE_IDLE_STORAGE_KEY, JSON.stringify(record))
  postOfficeIdle(channel, { kind: 'action', signedInAt: record.signedInAt, lastActionAt: record.lastActionAt })
  return record
}

/**
 * The mark this tab waits on. A shared stamp counts only for this sign-in.
 * The later one wins: another tab's newer action extends the wait, and an
 * older stamp left behind by a failed write does not pull this tab back.
 */
export function laterOfficeIdleAt(
  localAt: number | null,
  shared: SharedOfficeIdle | null,
  signedInAt: string | null,
): number | null {
  const sharedAt = shared !== null && signedInAt !== null && shared.signedInAt === signedInAt
    ? shared.lastActionAt
    : null
  if (localAt === null)
    return sharedAt
  if (sharedAt === null)
    return localAt
  return Math.max(localAt, sharedAt)
}

/**
 * A visible key, click, or command moves this tab even when publishing fails.
 * `apply` is that local move. A hidden tab, an older stamp, and a different
 * sign-in leave the clock where it is.
 */
export function noteOfficeIdleAction(
  storage: OfficeIdleStorage | null,
  channel: OfficeIdleChannel,
  local: SharedOfficeIdle,
  at: number,
  visible: boolean,
  apply: (record: SharedOfficeIdle) => void,
): void {
  const stored = readOfficeIdleMark(storage)
  const current = stored ?? local
  if (current.signedInAt !== local.signedInAt)
    return
  const next = sharedIdleAfterAction(current, at, visible)
  if (next === null)
    return
  apply(publishOfficeIdleMark(storage, channel, next))
}

/**
 * Ask the other tabs to follow, then sign this tab out.
 * `endSessionKeepingDraft` runs even when the write was skipped,
 * so a blocked store still ends the session and the draft stays.
 */
export function finishOfficeIdle(
  storage: OfficeIdleStorage | null,
  channel: OfficeIdleChannel,
  signedInAt: string | null,
  endSessionKeepingDraft: () => void,
): void {
  if (signedInAt) {
    writeOfficeIdleRaw(storage, OFFICE_IDLE_END_KEY, JSON.stringify({ signedInAt }))
    postOfficeIdle(channel, { kind: 'end', signedInAt })
  }
  endSessionKeepingDraft()
}

function silentOfficeIdleChannel(): OfficeIdleChannel {
  return {
    postMessage() {
      // No channel. A storage event, when the store works, and the poll still run.
    },
    addEventListener() {
      // Nothing to hear.
    },
    removeEventListener() {
      // Nothing was subscribed.
    },
    close() {
      // Nothing was opened.
    },
  }
}

/**
 * `undefined` means this browser has no BroadcastChannel.
 * A constructor that throws is the same: this tab keeps its own clock.
 */
export function openOfficeIdleChannel(Factory: OfficeIdleChannelFactory | undefined): OfficeIdleChannel {
  if (typeof Factory !== 'function')
    return silentOfficeIdleChannel()
  try {
    const channel = new Factory(OFFICE_IDLE_CHANNEL)
    return {
      postMessage(message) {
        try {
          channel.postMessage(message)
        }
        catch {
          // The other tabs still have the storage event and the poll.
        }
      },
      addEventListener(type, listener) {
        channel.addEventListener(type, listener)
      },
      removeEventListener(type, listener) {
        channel.removeEventListener(type, listener)
      },
      close() {
        try {
          channel.close()
        }
        catch {
          // Already closed, or the browser refused. This tab is done with it.
        }
      },
    }
  }
  catch {
    return silentOfficeIdleChannel()
  }
}

export function parseOfficeIdleMessage(value: unknown): OfficeIdleMessage | null {
  const parsed = idleStamp(value)
  if (parsed === null)
    return null
  if (parsed.lastActionAt === undefined)
    return { kind: 'end', signedInAt: parsed.signedInAt }
  return { kind: 'action', signedInAt: parsed.signedInAt, lastActionAt: parsed.lastActionAt }
}
