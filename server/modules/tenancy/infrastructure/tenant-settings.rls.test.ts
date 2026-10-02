import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * RLS seam: a fake cannot prove Tenant A is hidden from Tenant B.
 * The observation is the rows each session gets back, not the policy text.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const pool = new pg.Pool({ connectionString: databaseUrl })

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'

beforeAll(async () => {
  const client = await pool.connect()
  client.release()
  // One settings row per tenant. Drop the fixtures so a second run can insert again.
  for (const tenantId of [tenantA, tenantB]) {
    await withTenant(tenantId, async (session) => {
      await session.query('delete from app.tenant_settings')
    })
  }
})

afterAll(async () => {
  await pool.end()
})

async function withTenant<T>(
  tenantId: string,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
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

it('tenant B cannot read or write Tenant A settings', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(
      'insert into app.tenant_settings (default_locale, time_zone) values ($1, $2)',
      ['hr', 'Europe/Zagreb'],
    )
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select default_locale, time_zone from app.tenant_settings')
    const updated = await client.query(
      'update app.tenant_settings set default_locale = $1',
      ['en'],
    )
    return { rows: selected.rows, updated: updated.rowCount }
  })

  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  const seenByA = await withTenant(tenantA, async (client) => {
    const selected = await client.query('select default_locale, time_zone from app.tenant_settings')
    return selected.rows
  })

  expect(seenByA).toEqual([{ default_locale: 'hr', time_zone: 'Europe/Zagreb' }])
})
