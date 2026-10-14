import { loadEnvFile } from 'node:process'
import { expect, it } from 'vitest'
import { assertReady, parseAppEnv } from '../core/index'

/**
 * Readiness against the local roles. The handler is the HTTP seam.
 * A closed port and the migrator URL are the two ways the probe fails:
 * no connection, and a connection that must not serve traffic.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

const ownerUrl = process.env.DATABASE_MIGRATE_URL
if (!ownerUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const healthy = parseAppEnv(process.env)
const handler = (await import('./ready.get')).default

it('returns ok when the runtime roles can use the database', async () => {
  await expect(handler({} as never)).resolves.toEqual({ status: 'ok' })
})

it('returns 503 when the database is unreachable', async () => {
  await expect(assertReady({
    ...healthy,
    DATABASE_URL: 'postgres://transferpro_app:unused@127.0.0.1:1/transferpro',
  })).rejects.toMatchObject({ statusCode: 503, message: 'Not ready' })
})

it('returns 503 when a runtime URL is the migrator role', async () => {
  await expect(assertReady({
    ...healthy,
    DATABASE_URL: ownerUrl,
  })).rejects.toMatchObject({ statusCode: 503, message: 'Not ready' })
})
