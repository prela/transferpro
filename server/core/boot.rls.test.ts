import { loadEnvFile } from 'node:process'
import { expect, it } from 'vitest'
import { assertRuntimeRole } from './infrastructure'

/**
 * Boot seam: a runtime connection is refused when its role is superuser,
 * has BYPASSRLS, or owns a table in schema app.
 * The migrator URL is not app env. This file loads it only so the owner
 * connection can be offered to the check, and loads `.env` because the
 * runner does not inject it.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

const ownerUrl = process.env.DATABASE_MIGRATE_URL
const databaseUrl = process.env.DATABASE_URL
const authDatabaseUrl = process.env.AUTH_DATABASE_URL
const queueDatabaseUrl = process.env.QUEUE_DATABASE_URL
if (!ownerUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')
if (!authDatabaseUrl)
  throw new Error('AUTH_DATABASE_URL is required (the transferpro_auth role)')
if (!queueDatabaseUrl)
  throw new Error('QUEUE_DATABASE_URL is required (the transferpro_queue role)')

it('refuses to start on a connection as transferpro_owner', async () => {
  await expect(assertRuntimeRole(ownerUrl)).rejects.toThrow(
    /refusing to start: transferpro_owner has BYPASSRLS, owns a table in schema app/,
  )
})

it('accepts a connection as transferpro_app', async () => {
  await assertRuntimeRole(databaseUrl)
})

it('accepts a connection as transferpro_auth', async () => {
  await assertRuntimeRole(authDatabaseUrl)
})

it('accepts a connection as transferpro_queue', async () => {
  await assertRuntimeRole(queueDatabaseUrl)
})
