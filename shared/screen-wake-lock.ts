export type PageVisibility = 'visible' | 'hidden'

/** The handle `navigator.wakeLock.request` returns. */
export interface ScreenWakeLockSentinel {
  readonly released: boolean
  release: () => Promise<void>
}

/**
 * The Screen Wake Lock API, or null when the browser has none.
 * Only the screen type is used: the meet sign must stay lit.
 */
export interface ScreenWakeLockPort {
  request: (type: 'screen') => Promise<ScreenWakeLockSentinel>
}

/**
 * Clock and the browser API are injected. The unit test never asks a
 * real device to stay awake.
 */
export interface ScreenWakeLockDeps {
  port: () => ScreenWakeLockPort | null
  visibility: () => PageVisibility
  listen: (onChange: () => void) => () => void
}

export interface ScreenWakeLockSession {
  /** The meet sign opened. A missing or refused lock does not reject. */
  open: () => Promise<void>
  /** The meet sign closed. The lock is released when one is held. */
  close: () => Promise<void>
  /** The card went away. Stops listening and releases. */
  stop: () => Promise<void>
}

/**
 * Keeps the phone screen on while the Driver holds up the meet sign
 * (ADR-0038). A browser without the API, or one that refuses the request,
 * still lets the sign open. A hidden tab drops the lock; coming back
 * asks again while the sign is still open.
 */
export function createScreenWakeLock(deps: ScreenWakeLockDeps): ScreenWakeLockSession {
  let held: ScreenWakeLockSentinel | null = null
  let wanted = false
  let generation = 0
  let stopListening = deps.listen(() => {
    void sync()
  })

  async function acquire(): Promise<void> {
    if (!wanted || deps.visibility() !== 'visible')
      return
    if (held && !held.released)
      return
    const port = deps.port()
    if (!port)
      return
    const ticket = ++generation
    let sentinel: ScreenWakeLockSentinel
    try {
      sentinel = await port.request('screen')
    }
    catch {
      return
    }
    // Close, a newer request, or a hidden tab won the race.
    if (!wanted || ticket !== generation || deps.visibility() !== 'visible') {
      await releaseSentinel(sentinel)
      return
    }
    held = sentinel
  }

  async function sync(): Promise<void> {
    if (!wanted)
      return
    // The user agent drops a screen lock when the document is hidden.
    // Forget the handle so the next visible moment asks again.
    if (deps.visibility() !== 'visible') {
      generation += 1
      held = null
      return
    }
    if (held?.released)
      held = null
    await acquire()
  }

  async function drop(): Promise<void> {
    wanted = false
    generation += 1
    const current = held
    held = null
    await releaseSentinel(current)
  }

  return {
    async open() {
      wanted = true
      await acquire()
    },
    close: drop,
    async stop() {
      stopListening()
      stopListening = () => {}
      await drop()
    },
  }
}

async function releaseSentinel(sentinel: ScreenWakeLockSentinel | null): Promise<void> {
  if (!sentinel || sentinel.released)
    return
  try {
    await sentinel.release()
  }
  catch {
    // The browser already released it when the tab hid.
  }
}
