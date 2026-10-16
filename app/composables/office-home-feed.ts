import type { LiveRefreshDeps, OfficeHome } from '../../shared'
import { createLiveRefresh, officeHomeSchema, officeHomeUrgentKeys } from '../../shared'

/**
 * One office-home read for the frame and for Home (ADR-0039).
 * The dashboard layout owns the timer. Home and the seven-day note read
 * the same snapshot, so a refresh sends one request.
 */

let refreshOfficeHome: () => Promise<void> = async () => {}
let ownerToken = 0

export function refreshSharedOfficeHome(): Promise<void> {
  return refreshOfficeHome()
}

export function useOfficeHomeFeed() {
  const snapshot = useState<OfficeHome | null>('office-home-snapshot', () => null)
  const loading = useState('office-home-loading', () => true)
  const loadError = useState('office-home-load-error', () => false)
  const automatic = useState('office-home-automatic', () => true)
  const refreshing = useState('office-home-refreshing', () => false)
  const updatedAtMs = useState<number | null>('office-home-updated-at', () => null)
  const failed = useState('office-home-failed', () => false)
  const announcedCount = useState('office-home-announced', () => 0)
  // Bumps after each settled read so Home can reload expiring documents with it.
  const generation = useState('office-home-generation', () => 0)
  return {
    snapshot,
    loading,
    loadError,
    automatic,
    refreshing,
    updatedAtMs,
    failed,
    announcedCount,
    generation,
  }
}

/**
 * Call once, from the office dashboard layout. A second call would arm a
 * second timer. Sign-out clears the snapshot so the next Tenant does not
 * see the previous counts.
 */
export function useOfficeHomeFeedOwner() {
  const feed = useOfficeHomeFeed()
  const token = ++ownerToken
  let attempted = false
  let loadTicket = 0

  async function loadSnapshot(isRefresh: boolean) {
    const ticket = ++loadTicket
    if (!isRefresh)
      feed.loading.value = true
    try {
      const next = officeHomeSchema.parse(await $fetch('/api/office-home'))
      if (ticket !== loadTicket)
        return 'stale' as const
      feed.snapshot.value = next
      feed.loadError.value = false
      return 'ok' as const
    }
    catch {
      if (ticket !== loadTicket)
        return 'stale' as const
      if (!isRefresh) {
        feed.snapshot.value = null
        feed.loadError.value = true
      }
      return 'fail' as const
    }
    finally {
      if (ticket === loadTicket) {
        feed.loading.value = false
        feed.generation.value += 1
      }
    }
  }

  const controller = import.meta.client
    ? createLiveRefresh(browserDeps(), {
        automatic: () => feed.automatic.value,
        async reload() {
          feed.refreshing.value = true
          try {
            const isRefresh = attempted
            attempted = true
            const outcome = await loadSnapshot(isRefresh)
            if (outcome === 'ok') {
              feed.updatedAtMs.value = Date.now()
              feed.failed.value = false
            }
            else if (outcome === 'fail') {
              feed.failed.value = true
            }
            return outcome
          }
          finally {
            feed.refreshing.value = false
          }
        },
        urgentKeys: () => feed.snapshot.value ? officeHomeUrgentKeys(feed.snapshot.value) : [],
        async announce(count) {
          if (count === 0) {
            feed.announcedCount.value = 0
            return
          }
          feed.announcedCount.value = 0
          await nextTick()
          feed.announcedCount.value = count
        },
      })
    : null

  refreshOfficeHome = () => controller?.refresh() ?? Promise.resolve()

  if (controller)
    watch(feed.automatic, () => controller.automaticChanged())

  onMounted(() => {
    void controller?.settle()
  })

  onScopeDispose(() => {
    controller?.stop()
    // A newer layout already owns the read. Do not clear its snapshot.
    if (token !== ownerToken)
      return
    feed.snapshot.value = null
    feed.loading.value = true
    feed.loadError.value = false
    feed.refreshing.value = false
    feed.updatedAtMs.value = null
    feed.failed.value = false
    feed.announcedCount.value = 0
    refreshOfficeHome = async () => {}
  })

  return feed
}

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
