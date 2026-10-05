import { afterEach, expect, it, vi } from 'vitest'

const baseEnv = {
  DATABASE_URL: 'postgres://app@127.0.0.1:5432/transferpro',
  AUTH_DATABASE_URL: 'postgres://auth@127.0.0.1:5432/transferpro',
  QUEUE_DATABASE_URL: 'postgres://queue@127.0.0.1:5432/transferpro',
  BETTER_AUTH_SECRET: 'transferpro-test-secret-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  NODE_ENV: 'test',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * Disabled path: without SENTRY_DSN, sentry.server.config.ts must not call
 * Sentry.init or mark the SDK as enabled.
 */
it('does not initialise Sentry when SENTRY_DSN is unset', async () => {
  vi.resetModules()
  for (const [key, value] of Object.entries(baseEnv))
    vi.stubEnv(key, value)
  delete process.env.SENTRY_DSN

  const init = vi.fn()
  const captureException = vi.fn()
  vi.doMock('@sentry/nuxt', () => ({
    init,
    captureException,
  }))

  const { parseAppEnv } = await import('./index')
  expect(parseAppEnv(process.env).SENTRY_DSN).toBeUndefined()

  await import('../../sentry.server.config')

  const { isSentryEnabled } = await import('./sentry')
  expect(init).not.toHaveBeenCalled()
  expect(isSentryEnabled()).toBe(false)
})
