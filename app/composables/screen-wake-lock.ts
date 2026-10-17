import type { Ref } from 'vue'
import type { ScreenWakeLockPort } from '../../shared'
import { createScreenWakeLock } from '../../shared'

/**
 * Browser adapter for the meet-sign wake lock (ADR-0038).
 * A missing API is a null port. The sign still opens.
 */
function browserPort(): ScreenWakeLockPort | null {
  const nav = navigator as Navigator & { wakeLock?: ScreenWakeLockPort }
  return nav.wakeLock ?? null
}

/** Asks the screen to stay on while `open` is true, and releases it on close. */
export function useMeetSignWakeLock(open: Ref<boolean>) {
  if (!import.meta.client)
    return

  const session = createScreenWakeLock({
    port: browserPort,
    visibility: () => document.visibilityState === 'visible' ? 'visible' : 'hidden',
    listen(onChange) {
      const handler = () => onChange()
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
  })

  watch(open, (isOpen) => {
    if (isOpen)
      void session.open()
    else
      void session.close()
  })

  onScopeDispose(() => {
    void session.stop()
  })
}
