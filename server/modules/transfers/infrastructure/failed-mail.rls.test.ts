import { loadEnvFile } from 'node:process'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { openTenantSession } from '../../../core/index'
import { failedInvitationsQuery, failedWorkOrdersQuery } from './failed-mail'

/**
 * The Home refresh must use the partial index on failed mail (ADR-0045).
 * A tiny table would otherwise be a sequential scan, so this turns that
 * scan off and then reads the plan of the real query.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const databaseUrl = required('DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const appPool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appDb = drizzle(appPool)
const dialect = new PgDialect()

afterAll(async () => {
  await appPool.end()
  await ownerPool.end()
})

it('finds failed work orders through the partial index on tenant_id', async () => {
  const defined = await ownerPool.query<{ indexdef: string }>(
    `select indexdef from pg_indexes
     where schemaname = 'app' and indexname = 'mail_outbox_failed_tenant_idx'`,
  )
  expect(defined.rows[0]?.indexdef ?? '').toContain(`state = 'failed'`)

  const compiled = dialect.sqlToQuery(failedWorkOrdersQuery())
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const explained = await appDb.transaction(async (transaction) => {
    return openTenantSession(transaction, { tenantId }, async () => {
      await transaction.execute(sql`set local enable_seqscan = off`)
      return transaction.execute(sql.raw(`explain (format json) ${compiled.sql}`))
    })
  })
  const plan = JSON.stringify(explained)
  expect(plan).toContain('mail_outbox_failed_tenant_idx')
  expect(compiled.sql).toContain(`'failed'`)
  expect(compiled.sql).not.toContain('email')
})

it('finds failed invitations through the same partial index, without an address', async () => {
  const compiled = dialect.sqlToQuery(failedInvitationsQuery())
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const explained = await appDb.transaction(async (transaction) => {
    return openTenantSession(transaction, { tenantId }, async () => {
      await transaction.execute(sql`set local enable_seqscan = off`)
      return transaction.execute(sql.raw(`explain (format json) ${compiled.sql}`))
    })
  })
  expect(JSON.stringify(explained)).toContain('mail_outbox_failed_tenant_idx')
  expect(compiled.sql).toContain(`'failed'`)
  expect(compiled.sql).toContain('app.tenant_invitation')
  expect(compiled.sql).not.toContain('email')
})
