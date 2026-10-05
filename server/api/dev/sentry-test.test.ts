import { afterEach, expect, it, vi } from 'vitest'

function thrown(run: () => unknown): unknown {
  try {
    return run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('returns 404 in production', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubGlobal('defineEventHandler', (fn: () => unknown) => fn)
  vi.stubGlobal('createError', (opts: { statusCode: number, statusMessage: string }) =>
    Object.assign(new Error(opts.statusMessage), opts))

  const handler = (await import('./sentry-test.get')).default
  expect(thrown(() => handler({} as never))).toMatchObject({ statusCode: 404 })
})

it('throws a deliberate test error outside production', async () => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubGlobal('defineEventHandler', (fn: () => unknown) => fn)

  const handler = (await import('./sentry-test.get')).default
  expect(thrown(() => handler({} as never))).toMatchObject({ message: 'Deliberate Sentry test error' })
})
