import { openRequestLog } from '../core/index'

/**
 * Runs after `boot.ts` (plugin filenames are alphabetical), so the logger
 * already has its level. The id is echoed on the response. Errors are
 * answered by `server/error.ts`, not by this hook.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const requestId = openRequestLog(getRequestHeader(event, 'x-request-id'))
    setResponseHeader(event, 'x-request-id', requestId)
  })
})
