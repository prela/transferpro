import { openRequestLog } from '../core/index'

/**
 * Runs after `boot.ts` (plugin filenames are alphabetical), so the logger
 * already has its level. The id is echoed on the response. Errors are
 * answered by `server/error.ts`, not by this hook.
 * This hook does not log the URL. The invitation id lives in the hash of
 * `/accept-invite`, which the server never receives (ADR-0013).
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const requestId = openRequestLog(getRequestHeader(event, 'x-request-id'))
    setResponseHeader(event, 'x-request-id', requestId)
  })
})
