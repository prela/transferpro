import { afterEach, expect, it, vi } from 'vitest'
import { REDACTED } from '../../shared/redact'
import { scrubSentryPayload } from '../../shared/sentry'
import { endRequestLog, runWithRequestId } from './index'
import { runWithTenantId } from './logger'
import {
  buildSentryOptions,
  captureServerException,
  markSentryEnabled,
  scrubSentryEvent,
} from './sentry'

afterEach(() => {
  endRequestLog()
})

it('captureServerException reports faults only after markSentryEnabled', () => {
  const capture = vi.fn()
  captureServerException(new Error('ignored before mark'))
  expect(capture).not.toHaveBeenCalled()

  markSentryEnabled(capture)
  captureServerException(new Error('fault'))
  expect(capture).toHaveBeenCalledOnce()
})

it('drops request bodies, cookies, and sensitive headers from the shared scrubber', () => {
  const event = {
    type: undefined,
    event_id: '00000000000000000000000000000000',
    platform: 'node',
    timestamp: 1,
    request: {
      data: {
        name: 'Ana Horvat',
        phone: '+385911112222',
        email: 'ana@example.com',
      },
      cookies: {
        session: 'session-cookie-value',
      },
      headers: {
        'Authorization': 'Bearer session-token-value',
        'Cookie': 'session=session-cookie-value',
        'Set-Cookie': 'session=session-cookie-value',
        'X-Request-Id': '6b1e0c3a-1111-4111-8111-111111111111',
      },
    },
  }

  const scrubbed = scrubSentryPayload(event)
  expect(scrubbed?.request).toEqual({
    headers: {
      'X-Request-Id': '6b1e0c3a-1111-4111-8111-111111111111',
    },
  })
  const text = JSON.stringify(scrubbed)
  expect(text).not.toContain('Ana Horvat')
  expect(text).not.toContain('ana@example.com')
  expect(text).not.toContain('+385911112222')
  expect(text).not.toContain('session-token-value')
  expect(text).not.toContain('session-cookie-value')
})

it('redacts a passenger name, phone, email, and an auth token in the shared scrubber', () => {
  const event = {
    type: undefined,
    event_id: '00000000000000000000000000000000',
    platform: 'node',
    timestamp: 1,
    extra: {
      passenger: {
        name: 'Ana Horvat',
        phone: '+385911112222',
        email: 'ana@example.com',
      },
      token: 'session-token-value',
      user_id: '6b1e0c3a-1111-4111-8111-111111111111',
    },
  }

  const scrubbed = scrubSentryPayload(event)
  expect(scrubbed?.extra).toEqual({
    passenger: {
      name: REDACTED,
      phone: REDACTED,
      email: REDACTED,
    },
    token: REDACTED,
    user_id: '6b1e0c3a-1111-4111-8111-111111111111',
  })
  const text = JSON.stringify(scrubbed)
  expect(text).not.toContain('Ana Horvat')
  expect(text).not.toContain('ana@example.com')
  expect(text).not.toContain('session-token-value')
  expect(text).not.toContain('+385911112222')
})

it('adds request_id and tenant_id tags from the log scope', () => {
  const requestId = '6b1e0c3a-1111-4111-8111-111111111111'
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const scrubbed = runWithRequestId(requestId, () =>
    runWithTenantId(tenantId, () =>
      scrubSentryEvent({
        type: undefined,
        event_id: '00000000000000000000000000000000',
        platform: 'node',
        timestamp: 1,
      } as import('@sentry/nuxt').ErrorEvent)))
  expect(scrubbed?.tags).toMatchObject({
    request_id: requestId,
    tenant_id: tenantId,
  })
})

it('buildSentryOptions keeps sendDefaultPii off', () => {
  const options = buildSentryOptions({
    dsn: 'https://example.invalid/1',
    environment: 'test',
    release: 'abc123',
  })
  expect(options.sendDefaultPii).toBe(false)
  expect(options.release).toBe('abc123')
  expect(options.environment).toBe('test')
})
