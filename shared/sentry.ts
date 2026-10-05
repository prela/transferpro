import { redact } from './redact'

export interface SentryInitInput {
  readonly dsn: string
  readonly release?: string
  readonly environment: string
}

/** Event shape passed to `beforeSend`. Sentry sends a richer object. */
export interface ScrubbableEvent {
  tags?: Record<string, string>
  [key: string]: unknown
}

const BLOCKED_REQUEST_HEADERS = new Set(['cookie', 'setcookie', 'authorization'])

function normalizeHeaderName(name: string): string {
  return name.toLowerCase().replaceAll('_', '').replaceAll('-', '')
}

/** Drops request bodies, cookies, and auth headers Sentry might attach despite sendDefaultPii: false. */
function scrubSentryRequest(event: Record<string, unknown>): void {
  const request = event.request
  if (request === null || typeof request !== 'object')
    return

  const req = request as Record<string, unknown>
  delete req.data
  delete req.cookies

  const headers = req.headers
  if (headers !== null && typeof headers === 'object') {
    for (const key of Object.keys(headers)) {
      if (BLOCKED_REQUEST_HEADERS.has(normalizeHeaderName(key)))
        delete (headers as Record<string, unknown>)[key]
    }
  }
}

/** Strips personal data from a Sentry event using the logger redaction list (#33). */
export function scrubSentryPayload<T>(event: T): T | null {
  const scrubbed = redact(event) as Record<string, unknown>
  scrubSentryRequest(scrubbed)
  return scrubbed as T
}

/**
 * Shared Sentry options for client and server. No session replay, no default PII.
 * Server config adds request/tenant tags in its own wrapper.
 */
export function buildBaseSentryOptions(input: SentryInitInput) {
  return {
    dsn: input.dsn,
    release: input.release,
    environment: input.environment,
    sendDefaultPii: false as const,
    beforeSend: scrubSentryPayload,
  }
}
