import { expect, it } from 'vitest'
import { parseAppEnv } from './index'

/**
 * Env seam: `parseAppEnv` is what boot reads. The log level is part of that
 * result, not a separate `process.env` lookup at log time.
 */
const base = {
  DATABASE_URL: 'postgres://app@127.0.0.1:5432/transferpro',
  AUTH_DATABASE_URL: 'postgres://auth@127.0.0.1:5432/transferpro',
  QUEUE_DATABASE_URL: 'postgres://queue@127.0.0.1:5432/transferpro',
  PLATFORM_DATABASE_URL: 'postgres://platform@127.0.0.1:5432/transferpro',
  BETTER_AUTH_SECRET: 'transferpro-test-secret-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  RESEND_API_KEY: 'test-resend-key',
}

it('defaults the log level to info in production and debug locally', () => {
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'resend' }).LOG_LEVEL).toBe('info')
  expect(parseAppEnv({ ...base, NODE_ENV: 'development' }).LOG_LEVEL).toBe('debug')
  expect(parseAppEnv({ ...base, LOG_LEVEL: '' }).LOG_LEVEL).toBe('debug')
})

it('uses an explicit log level from the environment', () => {
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'resend', LOG_LEVEL: 'warn' }).LOG_LEVEL).toBe('warn')
})

it('rejects an unknown log level', () => {
  expect(() => parseAppEnv({ ...base, LOG_LEVEL: 'verbose' })).toThrow()
})

it('allows a missing RESEND_API_KEY outside production', () => {
  const { RESEND_API_KEY: _removed, ...withoutKey } = base
  expect(parseAppEnv({ ...withoutKey, NODE_ENV: 'test' }).RESEND_API_KEY).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'test' }).RESEND_API_KEY).toBe('test-resend-key')
  expect(() => parseAppEnv({ ...withoutKey, NODE_ENV: 'production', MAILER: 'resend' })).toThrow()
  expect(parseAppEnv(withoutKey).RESEND_API_KEY).toBeUndefined()
})

it('requires MAILER=resend and the Resend key in production', () => {
  const { RESEND_API_KEY: _removed, ...withoutKey } = base
  expect(() => parseAppEnv({ ...base, NODE_ENV: 'production' })).toThrow()
  expect(() => parseAppEnv({ ...withoutKey, NODE_ENV: 'production', MAILER: 'resend' })).toThrow()
  expect(() => parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'console' })).toThrow()
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'resend' })).toMatchObject({
    MAILER: 'resend',
    RESEND_API_KEY: 'test-resend-key',
  })
})

it('accepts an optional SENTRY_DSN and SENTRY_RELEASE', () => {
  expect(parseAppEnv(base).SENTRY_DSN).toBeUndefined()
  expect(parseAppEnv(base).SENTRY_RELEASE).toBeUndefined()
  expect(parseAppEnv({
    ...base,
    SENTRY_DSN: 'https://o0.ingest.sentry.io/0',
    SENTRY_RELEASE: 'abc123def456',
  })).toMatchObject({
    SENTRY_DSN: 'https://o0.ingest.sentry.io/0',
    SENTRY_RELEASE: 'abc123def456',
  })
  expect(() => parseAppEnv({ ...base, SENTRY_DSN: 'not-a-url' })).toThrow()
})

it('requires the platform role url', () => {
  const { PLATFORM_DATABASE_URL: _removed, ...withoutPlatform } = base
  expect(() => parseAppEnv(withoutPlatform)).toThrow()
})

it('leaves MAILER unset in development and test', () => {
  expect(parseAppEnv(base).MAILER).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'test' }).MAILER).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'development', MAILER: 'console' }).MAILER).toBe('console')
  expect(parseAppEnv({ ...base, NODE_ENV: 'development', MAILER: 'resend' }).MAILER).toBe('resend')
})
