import type { LiveRefreshDeps, LiveRefreshOutcome } from '../../shared'
import { createLiveRefresh } from '../../shared'

/**
 * Browser adapter for the shared refresher (ADR-0039).
 * `resume` is the phone-unlock signal when the page was frozen without
 * a visibility change. A hidden tab never arms the timer.
 */
function browserDeps(): LiveRefreshDeps {
  return {
    visibility: () => document.visibilityState === 'visible' ? 'visible' : 'hidden',
    listen(onChange) {
      const onVisibility = () => onChange()
      document.addEventListener('visibilitychange', onVisibility)
      document.addEventListener('resume', onVisibility)
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        document.removeEventListener('resume', onVisibility)
      }
    },
    schedule(delayMs, fire) {
      const id = setTimeout(fire, delayMs)
      return () => clearTimeout(id)
    },
  }
}

export function useLiveRefresh(options: {
  reload: () => Promise<LiveRefreshOutcome>
  urgentKeys: () => readonly string[]
  onAnnounce: (count: number) => void
}) {
  const automatic = ref(true)
  const refreshing = ref(false)
  const updatedAt = ref<Date | null>(null)
  const failed = ref(false)

  const controller = import.meta.client
    ? createLiveRefresh(browserDeps(), {
        automatic: () => automatic.value,
        async reload() {
          refreshing.value = true
          try {
            const outcome = await options.reload()
            if (outcome === 'ok') {
              updatedAt.value = new Date()
              failed.value = false
            }
            else if (outcome === 'fail') {
              failed.value = true
            }
            return outcome
          }
          finally {
            refreshing.value = false
          }
        },
        urgentKeys: options.urgentKeys,
        announce: options.onAnnounce,
      })
    : null

  if (controller) {
    watch(automatic, () => controller.automaticChanged())
    onScopeDispose(() => controller.stop())
  }

  onMounted(() => {
    void controller?.settle()
  })

  return { automatic, refreshing, updatedAt, failed, refresh: () => controller?.refresh() ?? Promise.resolve() }
}
