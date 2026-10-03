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
  BETTER_AUTH_SECRET: 'transferpro-test-secret-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  RESEND_API_KEY: 'test-resend-key',
}

it('defaults the log level to info in production and debug locally', () => {
  expect(parseAppEnv({ ...base, NODE_ENV: 'production' }).LOG_LEVEL).toBe('info')
  expect(parseAppEnv({ ...base, NODE_ENV: 'development' }).LOG_LEVEL).toBe('debug')
  expect(parseAppEnv({ ...base, LOG_LEVEL: '' }).LOG_LEVEL).toBe('debug')
})

it('uses an explicit log level from the environment', () => {
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', LOG_LEVEL: 'warn' }).LOG_LEVEL).toBe('warn')
})

it('rejects an unknown log level', () => {
  expect(() => parseAppEnv({ ...base, LOG_LEVEL: 'verbose' })).toThrow()
})

it('requires RESEND_API_KEY except in test', () => {
  const { RESEND_API_KEY: _removed, ...withoutKey } = base
  expect(parseAppEnv({ ...withoutKey, NODE_ENV: 'test' }).RESEND_API_KEY).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'test' }).RESEND_API_KEY).toBe('test-resend-key')
  expect(() => parseAppEnv({ ...withoutKey, NODE_ENV: 'production' })).toThrow()
  expect(() => parseAppEnv(withoutKey)).toThrow()
})
