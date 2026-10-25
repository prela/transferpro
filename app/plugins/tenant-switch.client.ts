import { isOwnTenantSwitch, TENANT_SWITCH_CHANNEL, TENANT_SWITCH_STORAGE_KEY } from '../composables/session-shell'

/**
 * One session has one active Tenant. The tab that switches tells the
 * others to stop before the session moves, then sends them home once it
 * has moved. A held tab cannot submit the form that was on screen, and
 * its live refresh stops (ADR-0056).
 */
export default defineNuxtPlugin(() => {
  const originalFetch = window.fetch.bind(window)
  let held = false

  function hold() {
    if (held)
      return
    held = true
    document.documentElement.setAttribute('inert', '')
    window.fetch = () => Promise.reject(new DOMException('The company is changing.', 'AbortError'))
  }

  function release() {
    if (!held)
      return
    held = false
    document.documentElement.removeAttribute('inert')
    window.fetch = originalFetch
  }

  const channel = new BroadcastChannel(TENANT_SWITCH_CHANNEL)
  channel.addEventListener('message', (event) => {
    if (isOwnTenantSwitch(event.data))
      return
    if (event.data?.phase === 'leave')
      hold()
    if (event.data?.phase === 'stay')
      release()
    if (event.data?.phase === 'done')
      window.location.assign('/')
  })

  window.addEventListener('storage', (event) => {
    if (event.key !== TENANT_SWITCH_STORAGE_KEY || event.newValue === null)
      return
    window.location.assign('/')
  })
})
