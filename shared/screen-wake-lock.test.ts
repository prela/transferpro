import type { PageVisibility, ScreenWakeLockPort, ScreenWakeLockSentinel } from './screen-wake-lock'
import { expect, it } from 'vitest'
import { createScreenWakeLock } from './screen-wake-lock'

/**
 * The meet sign asks the browser to keep the screen on, and lets go when
 * the Driver closes it (ADR-0038). The port is injected so the test never
 * touches a real display.
 */
it('requests a screen wake lock while the meet sign is open and releases it on close', async () => {
  const requests: string[] = []
  const releases: number[] = []
  const harness = wakeHarness(countingPort(requests, releases))

  await harness.session.open()
  expect(requests).toEqual(['screen'])
  expect(releases).toEqual([])

  await harness.session.close()
  expect(releases).toEqual([1])

  await harness.session.open()
  expect(requests).toEqual(['screen', 'screen'])
  // A second open while the lock is still held does not ask again.
  await harness.session.open()
  expect(requests).toEqual(['screen', 'screen'])
})

it('shows the meet sign when the browser has no wake lock and when the request is refused', async () => {
  const missing = wakeHarness(null)
  await missing.session.open()
  await missing.session.close()

  const refused = wakeHarness({
    request() {
      return Promise.reject(new Error('not allowed'))
    },
  })
  await refused.session.open()
  await refused.session.close()
})

it('asks again when the page becomes visible and the browser has dropped the lock', async () => {
  const requests: string[] = []
  const releases: number[] = []
  const harness = wakeHarness(countingPort(requests, releases), 'hidden')

  await harness.session.open()
  expect(requests).toEqual([])

  harness.setVisibility('visible')
  await flush()
  expect(requests).toEqual(['screen'])

  harness.setVisibility('hidden')
  await flush()
  harness.setVisibility('visible')
  await flush()
  expect(requests).toEqual(['screen', 'screen'])
})

it('releases a lock that arrives after the meet sign has already closed', async () => {
  const releases: number[] = []
  let finish: ((sentinel: ScreenWakeLockSentinel) => void) | undefined
  const harness = wakeHarness({
    request() {
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })

  const opening = harness.session.open()
  await flush()
  await harness.session.close()
  finish?.(sentinel(releases, 1))
  await opening
  await flush()
  expect(releases).toEqual([1])
})

it('does not reject when releasing the lock fails', async () => {
  const harness = wakeHarness({
    async request() {
      return {
        released: false,
        release() {
          return Promise.reject(new Error('already released'))
        },
      }
    },
  })
  await harness.session.open()
  await harness.session.close()
})

function countingPort(requests: string[], releases: number[]): ScreenWakeLockPort {
  let nextId = 0
  return {
    async request(type) {
      requests.push(type)
      const id = ++nextId
      return sentinel(releases, id)
    },
  }
}

function sentinel(releases: number[], id: number): ScreenWakeLockSentinel {
  const handle: { released: boolean, release: () => Promise<void> } = {
    released: false,
    async release() {
      handle.released = true
      releases.push(id)
    },
  }
  return handle
}

function wakeHarness(port: ScreenWakeLockPort | null, visibility: PageVisibility = 'visible') {
  let current = visibility
  const listeners: Array<() => void> = []
  return {
    setVisibility(next: PageVisibility) {
      current = next
      for (const listener of [...listeners])
        listener()
    },
    session: createScreenWakeLock({
      port: () => port,
      visibility: () => current,
      listen(onChange) {
        listeners.push(onChange)
        return () => {
          const index = listeners.indexOf(onChange)
          if (index !== -1)
            listeners.splice(index, 1)
        }
      },
    }),
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
