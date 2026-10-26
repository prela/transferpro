import type { DriverSessionBanner, SessionShell } from '../../shared'
import { createOfficeIdleClock, DRIVER_WARNING_LEAD_MS, driverSessionBanners, OFFICE_SESSION_MS, OFFICE_WARNING_LEAD_MS, officeSessionWarning, sessionShellSchema } from '../../shared'
import { isOfficeMember, sessionShellKey } from './session-shell'

/**
 * Office idle and the absolute cap (ADR-0057).
 * The idle clock listens for a key or a pointer while the tab is visible.
 * The live refresh is a fetch, so it never reaches that clock.
 * A poll asks the server whether a holding Ride is still holding: ending
 * the Ride refuses the next use, and this screen then signs out without
 * deleting the draft.
 */
export function useSessionLifetime() {
  const { endSessionKeepingDraft } = useShellSignOut()
  const nowMs = ref(Date.now())
  const session = computed(() => readShell())
  const notices = computed(() => noticesFor(session.value, nowMs.value))
  // Survives a new layout. A fresh clock would treat that mount as a person.
  const idleMark = useState<number | null>('office-idle-at', () => null)
  const idleSession = useState<string | null>('office-idle-session', () => null)

  if (import.meta.client) {
    if (idleMark.value === null)
      idleMark.value = Date.now()
    const idle = createOfficeIdleClock(idleMark.value)
    let cancelIdle: (() => void) | undefined
    let cancelEnd: (() => void) | undefined
    let cancelPoll: (() => void) | undefined
    let idleOn = false
    let stopped = false

    function armIdle() {
      cancelIdle?.()
      // The wait is whatever is left of the half hour. A new timer of the
      // full half hour would let a refresh, or this screen mounting again,
      // push the sign-out out.
      const id = setTimeout(() => {
        nowMs.value = Date.now()
        if (idle.due(nowMs.value))
          void endSessionKeepingDraft()
        else
          armIdle()
      }, idle.remaining(Date.now()))
      cancelIdle = () => clearTimeout(id)
    }

    function onPersonAction() {
      const visible = document.visibilityState === 'visible'
      const at = Date.now()
      idle.action(at, visible)
      if (!visible)
        return
      idleMark.value = at
      armIdle()
    }

    function startIdle() {
      if (idleOn)
        return
      idleOn = true
      window.addEventListener('pointerdown', onPersonAction, true)
      window.addEventListener('keydown', onPersonAction, true)
      armIdle()
    }

    function stopIdle() {
      if (!idleOn)
        return
      idleOn = false
      window.removeEventListener('pointerdown', onPersonAction, true)
      window.removeEventListener('keydown', onPersonAction, true)
      cancelIdle?.()
      cancelIdle = undefined
    }

    function armEnd(current: SessionShell) {
      cancelEnd?.()
      const end = Date.parse(current.sessionEndsAt)
      const signedIn = Date.parse(current.signedInAt)
      const warnAt = current.role === 'driver'
        ? signedIn + OFFICE_SESSION_MS - DRIVER_WARNING_LEAD_MS
        : end - OFFICE_WARNING_LEAD_MS
      const now = Date.now()
      nowMs.value = now
      if (now >= end) {
        void endSessionKeepingDraft()
        return
      }
      const next = [warnAt, end].filter(at => at > now).sort((left, right) => left - right)[0] ?? end
      const id = setTimeout(() => {
        const latest = readShell()
        if (latest)
          armEnd(latest)
      }, Math.max(0, next - Date.now()))
      cancelEnd = () => clearTimeout(id)
    }

    async function poll() {
      if (!readShell())
        return
      try {
        const next = sessionShellSchema.parse(await $fetch('/api/session'))
        const current = useNuxtData<SessionShell | null>(sessionShellKey)
        current.data.value = next
        nowMs.value = Date.now()
      }
      catch (error) {
        if (httpStatus(error) === 401)
          await endSessionKeepingDraft()
      }
    }

    function armPoll() {
      const id = setTimeout(() => {
        void poll().finally(() => {
          if (!stopped)
            armPoll()
        })
      }, 60_000)
      cancelPoll = () => clearTimeout(id)
    }

    function follow(next: SessionShell | null) {
      if (stopped)
        return
      if (!next) {
        stopIdle()
        cancelEnd?.()
        return
      }
      // A new sign-in starts its own half hour. The same sign-in keeps the mark.
      if (idleSession.value !== next.signedInAt) {
        idleSession.value = next.signedInAt
        const at = Date.now()
        idleMark.value = at
        idle.action(at, true)
      }
      armEnd(next)
      if (isOfficeMember(next.role))
        startIdle()
      else
        stopIdle()
    }

    watch(session, follow)
    onMounted(() => {
      follow(session.value)
      armPoll()
    })
    onScopeDispose(() => {
      stopped = true
      stopIdle()
      cancelEnd?.()
      cancelPoll?.()
    })
  }

  return { notices }
}

function readShell(): SessionShell | null {
  const current = useNuxtData<SessionShell | null>(sessionShellKey)
  const parsed = sessionShellSchema.safeParse(current.data.value)
  return parsed.success ? parsed.data : null
}

export type SessionNotice = DriverSessionBanner | 'office'

function noticesFor(session: SessionShell | null, nowMs: number): SessionNotice[] {
  if (!session)
    return []
  const now = new Date(nowMs)
  const signedInAt = new Date(session.signedInAt)
  if (session.role === 'driver')
    return driverSessionBanners(signedInAt, now, session.holdingRide)
  if (isOfficeMember(session.role) && officeSessionWarning(signedInAt, now))
    return ['office']
  return []
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}
