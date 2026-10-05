import { getResponseHeader, send, setResponseHeader, setResponseStatus } from 'h3'
import { currentRequestId, getLogger, handleLoggedError, runWithRequestId } from './core/index'
import { captureServerException } from './core/sentry'

/**
 * Nitro's built-in handler is not used. In development it puts the stack
 * in the JSON body. In production it `console.error`s the full error.
 * Nitro still appends that handler and runs it unless `event.handled` is
 * set. `send` ends the response, which marks the event handled, so the
 * built-in handler does not run. This one logs once and writes three fields.
 * The error callback does not stay inside the request's async context, so
 * the id is read from the response header the request hook already set.
 */
export default defineNitroErrorHandler((error, event) => {
  const header = getResponseHeader(event, 'x-request-id')
  const requestId = typeof header === 'string' && header !== '' ? header : currentRequestId()
  const write = () => handleLoggedError(getLogger(), error, requestId)
  const body = requestId === undefined ? write() : runWithRequestId(requestId, write)
  if (body.statusCode >= 500)
    captureServerException(error)
  setResponseHeader(event, 'content-type', 'application/json')
  setResponseStatus(event, body.statusCode)
  return send(event, JSON.stringify(body))
})
