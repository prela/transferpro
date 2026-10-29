import { Buffer } from 'node:buffer'
import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { encryptInvoicingToken } from '../domain/token-cipher'

/**
 * Invoicing settings on their own (ADR-0051). The app role cannot read or
 * write another Tenant's row, cannot delete, and has no plaintext token column.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })

const tenantA = 'a438a438-0438-4438-8438-000000000001'
const tenantB = 'b438b438-0438-4438-8438-000000000002'
const token = 'catalog-token-abcdefgh'
const key = new Uint8Array(32).fill(8)

beforeAll(async () => {
  await ownerPool.query('delete from app.invoicing_settings where tenant_id in ($1, $2)', [tenantA, tenantB])
})

afterAll(async () => {
  await pool.end()
  await ownerPool.end()
})

async function withTenant<T>(tenantId: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantId])
    const result = await run(client)
    await client.query('commit')
    return result
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}

it('stores ciphertext only, and Tenant A cannot read or write Tenant B', async () => {
  const sealed = encryptInvoicingToken(token, key, tenantA)
  await withTenant(tenantA, client => client.query(
    `insert into app.invoicing_settings (due_days, vat_rate, line_text, version, token_ciphertext, token_nonce, token_last_four)
     values (15, 25, 'Transfer', 1, $1, $2, $3)`,
    [sealed.ciphertext, sealed.nonce, 'efgh'],
  ))

  const seenByB = await withTenant(tenantB, client => client.query('select due_days, token_last_four from app.invoicing_settings'))
  expect(seenByB.rows).toEqual([])

  const updated = await withTenant(tenantB, client => client.query(
    `update app.invoicing_settings set due_days = 1 where token_last_four = 'efgh'`,
  ))
  expect(updated.rowCount).toBe(0)

  await expect(withTenant(tenantB, client => client.query(
    `insert into app.invoicing_settings (tenant_id, due_days, vat_rate, line_text) values ($1, 15, 25, 'Transfer')`,
    [tenantA],
  ))).rejects.toMatchObject({ code: '42501' })

  const stored = await ownerPool.query<{ due_days: number, token_ciphertext: Buffer }>(
    `select due_days, token_ciphertext from app.invoicing_settings where tenant_id = $1`,
    [tenantA],
  )
  expect(stored.rows[0]?.due_days).toBe(15)
  expect(stored.rows[0]?.token_ciphertext.equals(Buffer.from(token))).toBe(false)
  expect(stored.rows[0]?.token_ciphertext.toString('utf8')).not.toContain(token)
})

it('has no plaintext token column and no DELETE grant', async () => {
  const columns = await ownerPool.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'app' and table_name = 'invoicing_settings'`,
  )
  const names = columns.rows.map(row => row.column_name).sort()
  expect(names).toEqual([
    'due_days',
    'line_text',
    'tenant_id',
    'token_ciphertext',
    'token_last_four',
    'token_nonce',
    'vat_rate',
    'version',
  ])

  await expect(withTenant(tenantA, client => client.query('delete from app.invoicing_settings'))).rejects.toMatchObject({ code: '42501' })
})
