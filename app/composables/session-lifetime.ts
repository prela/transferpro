import type { DriverSessionBanner, SessionShell, SharedOfficeIdle } from '../../shared'
import { createOfficeIdleClock, DRIVER_WARNING_LEAD_MS, driverSessionBanners, OFFICE_IDLE_CHANNEL, OFFICE_IDLE_END_KEY, OFFICE_IDLE_MS, OFFICE_IDLE_STORAGE_KEY, OFFICE_SESSION_MS, OFFICE_WARNING_LEAD_MS, officeSessionWarning, parseOfficeIdleMessage, readSharedOfficeIdle, readSharedOfficeIdleEnd, sessionShellSchema, sharedIdleAfterAction, sharedIdleForSession } from '../../shared'
import { isOfficeMember, sessionShellKey } from './session-shell'

/**
 * Office idle and the absolute cap (ADR-0057).
 * One idle mark is shared by every tab of this browser. A key, a click,
 * or a command in a visible tab moves it. A live refresh is a fetch, and
 * a hidden tab is not a person's action, so neither moves it.
 * When the half hour passes, this tab signs out and tells the others.
 * The draft stays. A poll also signs out when the server has ended the session.
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
    const storedAtStart = readSharedOfficeIdle(localStorage.getItem(OFFICE_IDLE_STORAGE_KEY))
    if (idleMark.value === null)
      idleMark.value = storedAtStart?.lastActionAt ?? Date.now()
    const idle = createOfficeIdleClock(storedAtStart?.lastActionAt ?? idleMark.value)
    let cancelIdle: (() => void) | undefined
    let cancelEnd: (() => void) | undefined
    let cancelPoll: (() => void) | undefined
    let idleOn = false
    let stopped = false
    let ending = false
    const channel = new BroadcastChannel(OFFICE_IDLE_CHANNEL)

    function armIdle() {
      cancelIdle?.()
      const shared = readSharedOfficeIdle(localStorage.getItem(OFFICE_IDLE_STORAGE_KEY))
      if (shared?.signedInAt === idleSession.value)
        idle.reset(shared.lastActionAt)
      // The wait is whatever is left of the shared half hour. A fresh
      // half hour here would let a refresh, or another tab mounting,
      // push the sign-out out.
      const id = setTimeout(() => {
        nowMs.value = Date.now()
        const shared = readSharedOfficeIdle(localStorage.getItem(OFFICE_IDLE_STORAGE_KEY))
        if (shared && shared.signedInAt === idleSession.value && shared.lastActionAt > (idleMark.value ?? 0))
          applyMark(shared)
        if (idle.due(nowMs.value))
          endFromIdle()
        else
          armIdle()
      }, idle.remaining(Date.now()))
      cancelIdle = () => clearTimeout(id)
    }

    function applyMark(record: SharedOfficeIdle) {
      idle.reset(record.lastActionAt)
      idleMark.value = record.lastActionAt
      if (idleOn)
        armIdle()
    }

    function publishMark(record: SharedOfficeIdle) {
      localStorage.setItem(OFFICE_IDLE_STORAGE_KEY, JSON.stringify(record))
      channel.postMessage({ kind: 'action', signedInAt: record.signedInAt, lastActionAt: record.lastActionAt })
      applyMark(record)
    }

    function endFromIdle() {
      if (ending)
        return
      ending = true
      const signedInAt = idleSession.value ?? readShell()?.signedInAt
      if (signedInAt) {
        localStorage.setItem(OFFICE_IDLE_END_KEY, JSON.stringify({ signedInAt }))
        channel.postMessage({ kind: 'end', signedInAt })
      }
      void endSessionKeepingDraft()
    }

    function onRemoteEnd(signedInAt: string) {
      const current = idleSession.value ?? readShell()?.signedInAt
      if (current !== signedInAt)
        return
      if (ending)
        return
      ending = true
      void endSessionKeepingDraft()
    }

    function onRemoteAction(record: SharedOfficeIdle) {
      if (record.signedInAt !== idleSession.value)
        return
      if (record.lastActionAt <= (idleMark.value ?? 0))
        return
      applyMark(record)
    }

    function onStorage(event: StorageEvent) {
      if (event.storageArea !== localStorage)
        return
      if (event.key === OFFICE_IDLE_STORAGE_KEY) {
        const record = readSharedOfficeIdle(event.newValue)
        if (record)
          onRemoteAction(record)
      }
      if (event.key === OFFICE_IDLE_END_KEY) {
        const end = readSharedOfficeIdleEnd(event.newValue)
        if (end)
          onRemoteEnd(end.signedInAt)
      }
    }

    function onChannel(event: MessageEvent) {
      const message = parseOfficeIdleMessage(event.data)
      if (message === null)
        return
      if (message.kind === 'end')
        onRemoteEnd(message.signedInAt)
      else
        onRemoteAction(message)
    }

    function onPersonAction() {
      const signedInAt = idleSession.value
      if (!signedInAt)
        return
      const current = readSharedOfficeIdle(localStorage.getItem(OFFICE_IDLE_STORAGE_KEY))
        ?? { signedInAt, lastActionAt: idleMark.value ?? Date.now() }
      if (current.signedInAt !== signedInAt)
        return
      const next = sharedIdleAfterAction(current, Date.now(), document.visibilityState === 'visible')
      if (next === null)
        return
      publishMark(next)
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
      const shell = readShell()
      if (!shell)
        return
      const shared = readSharedOfficeIdle(localStorage.getItem(OFFICE_IDLE_STORAGE_KEY))
      // The dedicated timer can be a full half hour if this tab's clock
      // lagged the mark. The poll is the backstop: the shared mark is due.
      if (isOfficeMember(shell.role) && shared?.signedInAt === shell.signedInAt && Date.now() - shared.lastActionAt >= OFFICE_IDLE_MS) {
        endFromIdle()
        return
      }
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
      const ended = readSharedOfficeIdleEnd(localStorage.getItem(OFFICE_IDLE_END_KEY))
      if (ended?.signedInAt === next.signedInAt) {
        onRemoteEnd(next.signedInAt)
        return
      }
      // The first tab of a sign-in starts the half hour. A later tab keeps that mark.
      if (idleSession.value !== next.signedInAt) {
        idleSession.value = next.signedInAt
        const stored = readSharedOfficeIdle(localStorage.getItem(OFFICE_IDLE_STORAGE_KEY))
        const aligned = sharedIdleForSession(stored, next.signedInAt, Date.now())
        if (stored?.signedInAt !== next.signedInAt) {
          localStorage.removeItem(OFFICE_IDLE_END_KEY)
          publishMark(aligned)
        }
        else {
          applyMark(aligned)
        }
      }
      armEnd(next)
      if (isOfficeMember(next.role))
        startIdle()
      else
        stopIdle()
    }

    watch(session, follow)
    onMounted(() => {
      window.addEventListener('storage', onStorage)
      channel.addEventListener('message', onChannel)
      follow(session.value)
      armPoll()
    })
    onScopeDispose(() => {
      stopped = true
      stopIdle()
      cancelEnd?.()
      cancelPoll?.()
      window.removeEventListener('storage', onStorage)
      channel.removeEventListener('message', onChannel)
      channel.close()
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
