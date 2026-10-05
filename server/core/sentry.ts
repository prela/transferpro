import type { ErrorEvent, EventHint } from '@sentry/nuxt'
import type { SentryInitInput } from '../../shared/sentry'
import { scrubSentryPayload } from '../../shared/sentry'
import { currentRequestId, currentTenantId } from './logger'

let enabled = false
let captureException: ((error: unknown) => void) | undefined

/** True after `sentry.server.config.ts` initialises the SDK. */
export function isSentryEnabled(): boolean {
  return enabled
}

/** Called from the Sentry server config once the SDK is active. */
export function markSentryEnabled(capture: (error: unknown) => void): void {
  enabled = true
  captureException = capture
}

/** Reports a server fault when Sentry is configured. No-op otherwise. */
export function captureServerException(error: unknown): void {
  if (!enabled || captureException === undefined)
    return
  captureException(error)
}

/**
 * Server Sentry options. Adds request/tenant tags from the log scope (#33),
 * then scrubs personal data.
 */
export function buildSentryOptions(input: SentryInitInput) {
  return {
    dsn: input.dsn,
    release: input.release,
    environment: input.environment,
    sendDefaultPii: false as const,
    beforeSend: scrubSentryEvent,
  }
}

/** Strips personal data and adds request/tenant tags from the log scope. */
export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  const requestId = currentRequestId()
  const tenantId = currentTenantId()
  const tags: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.tags ?? {})) {
    if (typeof value === 'string')
      tags[key] = value
  }
  if (requestId !== undefined)
    tags.request_id = requestId
  if (tenantId !== undefined)
    tags.tenant_id = tenantId
  return scrubSentryPayload({ ...event, tags }) as unknown as ErrorEvent
}
