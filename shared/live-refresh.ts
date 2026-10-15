import type { DisplayLocale } from './display-locale'
import { formatInstant } from './format-instant'

/**
 * One minute. Home, Transfers, and the Driver list share this interval
 * while the tab is visible (ADR-0039).
 */
export const LIVE_REFRESH_MS = 60_000

export type PageVisibility = 'visible' | 'hidden'

/** `stale` means a newer reload already owns the outcome. */
export type LiveRefreshOutcome = 'ok' | 'fail' | 'stale'

/**
 * Clock and visibility are injected so the interval can be tested without
 * a browser. `schedule` returns a cancel function.
 */
export interface LiveRefreshDeps {
  visibility: () => PageVisibility
  listen: (onChange: () => void) => () => void
  schedule: (delayMs: number, fire: () => void) => () => void
}

export interface LiveRefreshOptions {
  /** Reads the screen. Rejecting is a failure. */
  reload: () => Promise<LiveRefreshOutcome>
  /** The "Automatsko osvježavanje" switch. Off stops the timer. */
  automatic: () => boolean
  /** Urgent keys after a successful reload. The first success only records them. */
  urgentKeys: () => readonly string[]
  /**
   * `count` is how many urgent keys are new. Zero clears the polite
   * announcement so an unchanged refresh says nothing.
   */
  announce: (count: number) => void
}

export interface LiveRefreshController {
  /** Timer tick and return from a hidden tab. No request while hidden or while automatic is off. */
  settle: () => Promise<void>
  /** The user's command. Runs while automatic is off. A hidden tab still runs it. */
  refresh: () => Promise<void>
  /** Call after the switch changes. Turning it on does not reload immediately. */
  automaticChanged: () => void
  stop: () => void
}

/**
 * Keys present in `next` and absent from `previous`, in `next`'s order.
 */
export function addedKeys(previous: readonly string[], next: readonly string[]): string[] {
  const seen = new Set(previous)
  return next.filter(key => !seen.has(key))
}

/**
 * HH:MM in the Tenant zone. The date stays inside `formatInstant`; this
 * only keeps the clock the refresh line shows.
 */
export function clockLabel(instant: Date, timeZone: string, locale: DisplayLocale): string {
  const formatted = formatInstant(instant, timeZone, locale)
  const time = formatted.slice(-5)
  if (!/^\d{2}:\d{2}$/.test(time))
    throw new RangeError('Missing clock time from the formatted instant.')
  return time
}

type RunKind = 'settle' | 'refresh'

/**
 * Shared refresher (ADR-0039). A hidden tab sends no automatic request.
 * The first successful read records urgent keys and does not announce them.
 */
export function createLiveRefresh(deps: LiveRefreshDeps, options: LiveRefreshOptions): LiveRefreshController {
  let stopped = false
  let running = false
  let follow: RunKind | null = null
  let cancelTimer: (() => void) | null = null
  let knownUrgent: readonly string[] | null = null

  function clearTimer() {
    cancelTimer?.()
    cancelTimer = null
  }

  function arm() {
    clearTimer()
    if (stopped || !options.automatic() || deps.visibility() !== 'visible')
      return
    cancelTimer = deps.schedule(LIVE_REFRESH_MS, () => {
      cancelTimer = null
      void run('settle')
    })
  }

  async function run(kind: RunKind) {
    if (stopped)
      return
    if (running) {
      follow = follow === 'refresh' || kind === 'refresh' ? 'refresh' : 'settle'
      return
    }
    if (kind === 'settle' && (deps.visibility() !== 'visible' || !options.automatic())) {
      clearTimer()
      return
    }

    running = true
    clearTimer()
    let outcome: LiveRefreshOutcome = 'fail'
    try {
      outcome = await options.reload()
    }
    catch {
      outcome = 'fail'
    }

    if (!stopped && outcome === 'ok') {
      const next = options.urgentKeys()
      if (knownUrgent !== null)
        options.announce(addedKeys(knownUrgent, next).length)
      knownUrgent = next
    }

    running = false
    if (stopped)
      return
    arm()
    const nextRun = follow
    follow = null
    if (nextRun)
      await run(nextRun)
  }

  function onVisibility() {
    if (deps.visibility() !== 'visible') {
      clearTimer()
      return
    }
    void run('settle')
  }

  const unlisten = deps.listen(onVisibility)

  return {
    settle: () => run('settle'),
    refresh: () => run('refresh'),
    automaticChanged() {
      if (!options.automatic() || deps.visibility() !== 'visible')
        clearTimer()
      else
        arm()
    },
    stop() {
      stopped = true
      clearTimer()
      unlisten()
    },
  }
}
