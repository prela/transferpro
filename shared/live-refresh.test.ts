import type { LiveRefreshDeps, LiveRefreshOutcome, PageVisibility } from './live-refresh'
import { expect, it } from 'vitest'
import { clockLabel, createLiveRefresh, LIVE_REFRESH_MS } from './live-refresh'

/**
 * The interval is the spec's minute, not a copy of the scheduler's arithmetic.
 * 15 Jan 2026 23:30 UTC is 16 Jan 00:30 in Europe/Zagreb.
 */

it('keeps the clock time from the shared instant format', () => {
  const winterUtc = new Date('2026-01-15T23:30:00.000Z')
  expect(clockLabel(winterUtc, 'Europe/Zagreb', 'hr')).toBe('00:30')
  expect(clockLabel(winterUtc, 'Europe/Zagreb', 'en')).toBe('00:30')
  expect(clockLabel(winterUtc, 'UTC', 'en')).toBe('23:30')
  expect(LIVE_REFRESH_MS).toBe(60_000)
})

it('refuses a formatted instant that has no clock time', () => {
  expect(() => clockLabel(new Date('not-a-time'), 'Europe/Zagreb', 'hr')).toThrow(RangeError)
})

interface Harness {
  visibility: PageVisibility
  automatic: boolean
  keys: string[]
  outcome: LiveRefreshOutcome | 'throw'
  reloads: number
  announcements: number[]
  delays: number[]
  pendingTimers: number
  setVisibility: (next: PageVisibility) => void
  advance: (ms: number) => Promise<void>
  controller: ReturnType<typeof createLiveRefresh>
}

function harness(initial: PageVisibility = 'visible'): Harness {
  let visibility: PageVisibility = initial
  let now = 0
  const listeners: Array<() => void> = []
  const timers: Array<{ at: number, delay: number, fire: () => void, cleared: boolean }> = []
  const state: Harness = {
    visibility: initial,
    automatic: true,
    keys: [],
    outcome: 'ok',
    reloads: 0,
    announcements: [],
    delays: [],
    pendingTimers: 0,
    setVisibility(next) {
      visibility = next
      state.visibility = next
      for (const listener of listeners)
        listener()
    },
    async advance(ms) {
      now += ms
      const due = timers.filter(timer => !timer.cleared && timer.at <= now)
      for (const timer of due)
        timer.cleared = true
      for (const timer of due)
        timer.fire()
      state.pendingTimers = timers.filter(timer => !timer.cleared).length
      for (let step = 0; step < 20; step++)
        await Promise.resolve()
      state.pendingTimers = timers.filter(timer => !timer.cleared).length
    },
    controller: null as unknown as ReturnType<typeof createLiveRefresh>,
  }

  const deps: LiveRefreshDeps = {
    visibility: () => visibility,
    listen(onChange) {
      listeners.push(onChange)
      return () => {
        const index = listeners.indexOf(onChange)
        if (index !== -1)
          listeners.splice(index, 1)
      }
    },
    schedule(delayMs, fire) {
      state.delays.push(delayMs)
      const timer = { at: now + delayMs, delay: delayMs, fire, cleared: false }
      timers.push(timer)
      state.pendingTimers = timers.filter(item => !item.cleared).length
      return () => {
        timer.cleared = true
        state.pendingTimers = timers.filter(item => !item.cleared).length
      }
    },
  }

  state.controller = createLiveRefresh(deps, {
    async reload() {
      state.reloads += 1
      if (state.outcome === 'throw')
        throw new Error('read failed')
      return state.outcome
    },
    automatic: () => state.automatic,
    urgentKeys: () => state.keys,
    announce(count) {
      state.announcements.push(count)
    },
  })

  return state
}

it('reloads a visible tab after 60 seconds and not a second earlier', async () => {
  const page = harness()
  await page.controller.settle()
  expect(page.reloads).toBe(1)
  expect(page.delays).toEqual([60_000])

  await page.advance(59_000)
  expect(page.reloads).toBe(1)

  await page.advance(1_000)
  expect(page.reloads).toBe(2)
  expect(page.announcements).toEqual([0])
})

it('sends nothing while hidden and reloads at once when the tab returns', async () => {
  const page = harness('hidden')
  await page.controller.settle()
  expect(page.reloads).toBe(0)
  expect(page.pendingTimers).toBe(0)

  await page.advance(120_000)
  expect(page.reloads).toBe(0)

  page.setVisibility('visible')
  for (let step = 0; step < 20; step++)
    await Promise.resolve()
  expect(page.reloads).toBe(1)
  expect(page.pendingTimers).toBe(1)
})

it('stops the timer when automatic refresh is off and still refreshes on command', async () => {
  const page = harness()
  await page.controller.settle()
  page.automatic = false
  page.controller.automaticChanged()
  expect(page.pendingTimers).toBe(0)

  await page.advance(120_000)
  expect(page.reloads).toBe(1)

  await page.controller.refresh()
  expect(page.reloads).toBe(2)
  expect(page.pendingTimers).toBe(0)
})

it('does not reload when a hidden tab returns with automatic refresh off', async () => {
  const page = harness()
  await page.controller.settle()
  page.automatic = false
  page.controller.automaticChanged()
  page.setVisibility('hidden')
  page.setVisibility('visible')
  for (let step = 0; step < 20; step++)
    await Promise.resolve()
  expect(page.reloads).toBe(1)
})

it('announces only urgent keys that were not on the previous success', async () => {
  const page = harness()
  page.keys = ['unassigned-alarm:a']
  await page.controller.settle()
  expect(page.announcements).toEqual([])

  page.keys = ['unassigned-alarm:a', 'unclosed-mark:b']
  await page.controller.refresh()
  expect(page.announcements).toEqual([1])

  await page.controller.refresh()
  expect(page.announcements).toEqual([1, 0])
})

it('keeps the urgent baseline when a refresh fails', async () => {
  const page = harness()
  page.keys = ['unassigned-alarm:a']
  await page.controller.settle()

  page.outcome = 'fail'
  page.keys = ['unassigned-alarm:a', 'landing-alarm:c']
  await page.controller.refresh()
  expect(page.announcements).toEqual([])

  page.outcome = 'throw'
  await page.controller.refresh()
  expect(page.announcements).toEqual([])

  page.outcome = 'ok'
  await page.controller.refresh()
  expect(page.announcements).toEqual([1])
})

it('ignores a stale reload when deciding the announcement', async () => {
  const page = harness()
  page.keys = ['unassigned-alarm:a']
  await page.controller.settle()
  page.outcome = 'stale'
  page.keys = ['landing-alarm:c']
  await page.controller.refresh()
  expect(page.announcements).toEqual([])

  page.outcome = 'ok'
  await page.controller.refresh()
  expect(page.announcements).toEqual([1])
})

it('stops listening and clears the timer', async () => {
  const page = harness()
  await page.controller.settle()
  page.controller.stop()
  expect(page.pendingTimers).toBe(0)
  page.setVisibility('hidden')
  page.setVisibility('visible')
  await page.advance(120_000)
  expect(page.reloads).toBe(1)
})
