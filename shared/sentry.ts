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

/** Strips personal data from a Sentry event using the logger redaction list (#33). */
export function scrubSentryPayload<T>(event: T): T | null {
  return redact(event) as T
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
