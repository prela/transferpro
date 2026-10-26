import type { OfficeIdleChannel, OfficeIdleStorage } from './member-session'
import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'
import { clearOfficeIdleEnd, createOfficeIdleClock, DRIVER_HELD_SESSION_MS, DRIVER_WARNING_LEAD_MS, driverSessionBanners, finishOfficeIdle, laterOfficeIdleAt, memberSessionCapMs, noteOfficeIdleAction, OFFICE_IDLE_MS, OFFICE_SESSION_MS, OFFICE_WARNING_LEAD_MS, officeSessionWarning, openOfficeIdleChannel, parseOfficeIdleMessage, readOfficeIdleEndMark, readOfficeIdleMark, readSharedOfficeIdle, readSharedOfficeIdleEnd, rideHoldsDriverSession, sharedIdleAfterAction, sharedIdleForSession } from './member-session'

const signedIn = new Date('2026-10-25T06:00:00.000Z')

it('caps an office session at twelve hours and a held driver session at sixteen', () => {
  expect(memberSessionCapMs('admin', false)).toBe(OFFICE_SESSION_MS)
  expect(memberSessionCapMs('dispatcher', true)).toBe(OFFICE_SESSION_MS)
  expect(memberSessionCapMs('driver', false)).toBe(OFFICE_SESSION_MS)
  expect(memberSessionCapMs('driver', true)).toBe(DRIVER_HELD_SESSION_MS)
  expect(OFFICE_SESSION_MS).toBe(12 * 60 * 60 * 1000)
  expect(DRIVER_HELD_SESSION_MS).toBe(16 * 60 * 60 * 1000)
})

it('warns the office for the last fifteen minutes and not after the cap', () => {
  const before = new Date(signedIn.getTime() + OFFICE_SESSION_MS - OFFICE_WARNING_LEAD_MS - 1)
  const at = new Date(signedIn.getTime() + OFFICE_SESSION_MS - OFFICE_WARNING_LEAD_MS)
  const end = new Date(signedIn.getTime() + OFFICE_SESSION_MS)
  expect(officeSessionWarning(signedIn, before)).toBe(false)
  expect(officeSessionWarning(signedIn, at)).toBe(true)
  expect(officeSessionWarning(signedIn, new Date(end.getTime() - 1))).toBe(true)
  expect(officeSessionWarning(signedIn, end)).toBe(false)
})

it('shows the driver banners around twelve hours, and the cap banner only while a Ride holds', () => {
  const lead = new Date(signedIn.getTime() + OFFICE_SESSION_MS - DRIVER_WARNING_LEAD_MS)
  const before = new Date(lead.getTime() - 1)
  const twelve = new Date(signedIn.getTime() + OFFICE_SESSION_MS)
  const capLead = new Date(signedIn.getTime() + DRIVER_HELD_SESSION_MS - DRIVER_WARNING_LEAD_MS)
  const sixteen = new Date(signedIn.getTime() + DRIVER_HELD_SESSION_MS)

  expect(driverSessionBanners(signedIn, before, false)).toEqual([])
  expect(driverSessionBanners(signedIn, lead, false)).toEqual(['ending'])
  expect(driverSessionBanners(signedIn, twelve, false)).toEqual([])

  expect(driverSessionBanners(signedIn, before, true)).toEqual([])
  expect(driverSessionBanners(signedIn, lead, true)).toEqual(['held'])
  expect(driverSessionBanners(signedIn, twelve, true)).toEqual(['held'])
  expect(driverSessionBanners(signedIn, new Date(capLead.getTime() - 1), true)).toEqual(['held'])
  expect(driverSessionBanners(signedIn, capLead, true)).toEqual(['held', 'cap'])
  expect(driverSessionBanners(signedIn, new Date(sixteen.getTime() - 1), true)).toEqual(['held', 'cap'])
  expect(driverSessionBanners(signedIn, sixteen, true)).toEqual([])
  expect(driverSessionBanners(signedIn, capLead, false)).toEqual([])
})

it('holds a driver session only for today\'s in-progress Ride', () => {
  const now = instantFromWallClock('2026-10-25T12:00', 'Europe/Zagreb')
  const held = {
    state: 'accepted' as const,
    mustAccept: true,
    driverId: 'driver-1',
    pickupAt: instantFromWallClock('2026-10-25T09:00', 'Europe/Zagreb'),
    timeZone: 'Europe/Zagreb',
    operationalDayStartHour: 5,
  }
  expect(rideHoldsDriverSession(held, now)).toBe(true)
  expect(rideHoldsDriverSession({
    ...held,
    state: 'assigned',
    mustAccept: false,
  }, now)).toBe(true)
  expect(rideHoldsDriverSession({
    ...held,
    pickupAt: instantFromWallClock('2026-10-24T12:00', 'Europe/Zagreb'),
  }, now)).toBe(false)
  expect(rideHoldsDriverSession({
    ...held,
    pickupAt: instantFromWallClock('2026-10-25T18:00', 'Europe/Zagreb'),
  }, now)).toBe(false)
  expect(rideHoldsDriverSession({
    ...held,
    state: 'assigned',
    mustAccept: true,
  }, now)).toBe(false)
  for (const state of ['done', 'no-show', 'cancelled'] as const)
    expect(rideHoldsDriverSession({ ...held, state }, now)).toBe(false)
  expect(rideHoldsDriverSession({ ...held, driverId: null }, now)).toBe(false)
  expect(rideHoldsDriverSession({ ...held, state: 'handed_off', driverId: null }, now)).toBe(false)
})

it('resets the office idle clock on a visible action, and a hidden tab does not move the mark', () => {
  // A live refresh is not an action. The e2e in session-lifetime.spec.ts is that proof.
  // This clock has no refresh method.
  const started = { signedInAt: 'sign-in-1', lastActionAt: 0 }
  const clock = createOfficeIdleClock(started.lastActionAt)
  expect(clock.due(OFFICE_IDLE_MS - 1)).toBe(false)
  expect(clock.due(OFFICE_IDLE_MS)).toBe(true)
  expect(clock.remaining(10 * 60 * 1000)).toBe(OFFICE_IDLE_MS - 10 * 60 * 1000)

  // A hidden tab is not a person, so the mark stays where the clock started.
  expect(sharedIdleAfterAction(started, 10 * 60 * 1000, false)).toBeNull()
  expect(clock.due(OFFICE_IDLE_MS)).toBe(true)

  const visible = sharedIdleAfterAction(started, 5 * 60 * 1000, true)
  expect(visible).toEqual({ signedInAt: 'sign-in-1', lastActionAt: 5 * 60 * 1000 })
  clock.reset(5 * 60 * 1000)
  expect(clock.remaining(5 * 60 * 1000)).toBe(OFFICE_IDLE_MS)
  expect(clock.due(5 * 60 * 1000 + OFFICE_IDLE_MS - 1)).toBe(false)
  expect(clock.due(5 * 60 * 1000 + OFFICE_IDLE_MS)).toBe(true)

  clock.reset(0)
  expect(clock.due(OFFICE_IDLE_MS)).toBe(true)
})

function quotaStorage(stored: string): OfficeIdleStorage {
  return {
    getItem: () => stored,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    removeItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
}

function recordingChannel(posted: unknown[]): OfficeIdleChannel {
  return {
    postMessage(message) {
      posted.push(message)
    },
    addEventListener() {
      // This test only watches what this tab sends.
    },
    removeEventListener() {
      // Nothing was subscribed.
    },
    close() {
      // Nothing was opened.
    },
  }
}

function blockedStorage(): OfficeIdleStorage {
  const blocked = (): never => {
    throw new Error('SecurityError')
  }
  return { getItem: blocked, setItem: blocked, removeItem: blocked }
}

it('shares the idle mark when storage accepts the write', () => {
  const saved = new Map<string, string>()
  const storage: OfficeIdleStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => {
      saved.set(key, value)
    },
    removeItem: (key) => {
      saved.delete(key)
    },
  }
  const channel = openOfficeIdleChannel(undefined)
  const clock = createOfficeIdleClock(0)
  noteOfficeIdleAction(storage, channel, { signedInAt: 'sign-in-1', lastActionAt: 0 }, 5_000, true, (record) => {
    clock.reset(record.lastActionAt)
  })
  expect(readOfficeIdleMark(storage)).toEqual({ signedInAt: 'sign-in-1', lastActionAt: 5_000 })
  expect(clock.remaining(5_000)).toBe(OFFICE_IDLE_MS)
  let keptDraft = false
  finishOfficeIdle(storage, channel, 'sign-in-1', () => {
    keptDraft = true
  })
  expect(keptDraft).toBe(true)
  expect(readOfficeIdleEndMark(storage)).toEqual({ signedInAt: 'sign-in-1' })
})

it('resets this tab when a stale mark is readable and the write throws, without broadcasting', () => {
  const earlier = '2026-10-26T08:00:00.000Z'
  const stored = JSON.stringify({ signedInAt: earlier, lastActionAt: 0 })
  const storage = quotaStorage(stored)
  const posted: unknown[] = []
  const clock = createOfficeIdleClock(0)
  noteOfficeIdleAction(storage, recordingChannel(posted), { signedInAt: '2026-10-26T09:00:00.000Z', lastActionAt: 0 }, 60_000, true, (record) => {
    clock.reset(record.lastActionAt)
  })
  expect(posted).toEqual([])
  expect(readOfficeIdleMark(storage)).toEqual({ signedInAt: earlier, lastActionAt: 0 })
  // The stale stamp stays in storage. This tab still measures idle from the action.
  expect(clock.due(OFFICE_IDLE_MS)).toBe(false)
  expect(clock.remaining(60_000)).toBe(OFFICE_IDLE_MS)
  expect(clock.due(60_000 + OFFICE_IDLE_MS)).toBe(true)
})

it('does not replace a newer sign-in mark from an earlier tab', () => {
  const newer = JSON.stringify({ signedInAt: '2026-10-26T10:00:00.000Z', lastActionAt: 5_000 })
  let written = false
  const storage: OfficeIdleStorage = {
    getItem: () => newer,
    setItem: () => {
      written = true
    },
    removeItem: () => {
      written = true
    },
  }
  const posted: unknown[] = []
  const clock = createOfficeIdleClock(0)
  noteOfficeIdleAction(storage, recordingChannel(posted), { signedInAt: '2026-10-26T09:00:00.000Z', lastActionAt: 0 }, 60_000, true, (record) => {
    clock.reset(record.lastActionAt)
  })
  expect(written).toBe(false)
  expect(posted).toEqual([])
  expect(readOfficeIdleMark(storage)).toEqual({ signedInAt: '2026-10-26T10:00:00.000Z', lastActionAt: 5_000 })
  expect(clock.due(OFFICE_IDLE_MS)).toBe(true)
})

it('keeps a visible action when the old mark is still readable and the write throws', () => {
  const stored = JSON.stringify({ signedInAt: 'sign-in-1', lastActionAt: 0 })
  const storage = quotaStorage(stored)
  const channel = openOfficeIdleChannel(undefined)
  const clock = createOfficeIdleClock(0)
  noteOfficeIdleAction(storage, channel, { signedInAt: 'sign-in-1', lastActionAt: 0 }, 60_000, true, (record) => {
    clock.reset(record.lastActionAt)
  })
  const shared = readOfficeIdleMark(storage)
  expect(shared).toEqual({ signedInAt: 'sign-in-1', lastActionAt: 0 })
  // The readable stamp is the one the write did not replace. Idle is measured from the action.
  expect(laterOfficeIdleAt(60_000, shared, 'sign-in-1')).toBe(60_000)
  expect(laterOfficeIdleAt(60_000, { signedInAt: 'sign-in-1', lastActionAt: 120_000 }, 'sign-in-1')).toBe(120_000)
  expect(clock.due(OFFICE_IDLE_MS)).toBe(false)
  expect(clock.remaining(60_000)).toBe(OFFICE_IDLE_MS)
  expect(clock.due(60_000 + OFFICE_IDLE_MS)).toBe(true)
})

it('keeps this tab\'s idle clock when storage throws, and still signs out keeping the draft', () => {
  const storage = blockedStorage()
  const channel = openOfficeIdleChannel(undefined)
  const clock = createOfficeIdleClock(0)
  const local = { signedInAt: 'sign-in-1', lastActionAt: 0 }

  expect(readOfficeIdleMark(storage)).toBeNull()
  expect(readOfficeIdleEndMark(storage)).toBeNull()
  expect(() => clearOfficeIdleEnd(storage)).not.toThrow()

  noteOfficeIdleAction(storage, channel, local, 60_000, true, (record) => {
    clock.reset(record.lastActionAt)
  })

  expect(clock.remaining(60_000)).toBe(OFFICE_IDLE_MS)
  expect(clock.due(60_000 + OFFICE_IDLE_MS - 1)).toBe(false)
  expect(clock.due(60_000 + OFFICE_IDLE_MS)).toBe(true)

  let keptDraft = false
  finishOfficeIdle(storage, channel, local.signedInAt, () => {
    keptDraft = true
  })
  expect(keptDraft).toBe(true)
})

class BlockedChannel {
  constructor(_name: string) {
    throw new Error('SecurityError')
  }

  postMessage(): void {
    throw new Error('unreachable')
  }

  addEventListener(): void {
    throw new Error('unreachable')
  }

  removeEventListener(): void {
    throw new Error('unreachable')
  }

  close(): void {
    throw new Error('unreachable')
  }
}

it('signs this tab out when BroadcastChannel is missing or its constructor throws', () => {
  const storage = blockedStorage()
  const local = { signedInAt: 'sign-in-1', lastActionAt: 0 }
  for (const factory of [undefined, BlockedChannel]) {
    const channel = openOfficeIdleChannel(factory)
    const clock = createOfficeIdleClock(0)
    noteOfficeIdleAction(storage, channel, local, 1_000, true, (record) => {
      clock.reset(record.lastActionAt)
    })
    expect(clock.due(1_000 + OFFICE_IDLE_MS)).toBe(true)
    let keptDraft = false
    finishOfficeIdle(storage, channel, local.signedInAt, () => {
      keptDraft = true
    })
    expect(keptDraft).toBe(true)
    expect(() => {
      channel.close()
    }).not.toThrow()
  }
})

it('keeps one idle mark for every tab of a sign-in', () => {
  const started = sharedIdleForSession(null, 'sign-in-1', 0)
  expect(sharedIdleAfterAction(started, 5_000, false)).toBeNull()
  const typed = sharedIdleAfterAction(started, 5_000, true)
  expect(typed).toEqual({ signedInAt: 'sign-in-1', lastActionAt: 5_000 })
  if (typed === null)
    throw new Error('visible action did not move the idle mark')

  // Another tab opening later must not move the mark to its own clock.
  expect(sharedIdleForSession(typed, 'sign-in-1', 40 * 60 * 1000)).toEqual(typed)
  expect(sharedIdleAfterAction(typed, 1_000, true)).toBeNull()

  const again = sharedIdleForSession(typed, 'sign-in-2', 9_000)
  expect(again).toEqual({ signedInAt: 'sign-in-2', lastActionAt: 9_000 })

  const raw = JSON.stringify(typed)
  expect(readSharedOfficeIdle(raw)).toEqual(typed)
  expect(readSharedOfficeIdle('nope')).toBeNull()
  expect(readSharedOfficeIdleEnd(JSON.stringify({ signedInAt: 'sign-in-1' }))).toEqual({ signedInAt: 'sign-in-1' })
  expect(parseOfficeIdleMessage({ kind: 'action', signedInAt: 'sign-in-1', lastActionAt: 5_000 })).toEqual({
    kind: 'action',
    signedInAt: 'sign-in-1',
    lastActionAt: 5_000,
  })
  expect(parseOfficeIdleMessage({ kind: 'end', signedInAt: 'sign-in-1' })).toEqual({
    kind: 'end',
    signedInAt: 'sign-in-1',
  })
  expect(parseOfficeIdleMessage({ kind: 'end' })).toBeNull()
})
