import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * RLS seam: a fake cannot prove Tenant A is hidden from Tenant B.
 * The observation is the rows and the errors, not the policy text.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })

const tenantA = 'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1'
const tenantB = 'f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2'

beforeAll(async () => {
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.partners where tenant_id in ($1, $2)', [tenantA, tenantB])
  }
  finally {
    owner.release()
  }
})

afterAll(async () => {
  await pool.end()
  await ownerPool.end()
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

const insert = `insert into app.partners (name, phone, email, note) values ($1, $2, $3, $4)`

it('forces row level security on app.partners', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'partners'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A partners', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['Mora Transfer', '+385911110379', 'office@mora.example', 'Call the desk.'])
    await client.query(insert, ['Mora Transfer', null, null, null])
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select name from app.partners')
    const updated = await client.query(`update app.partners set name = 'Changed'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.partners (tenant_id, name) values ($1, 'Other')`,
      [tenantA],
    ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('update app.partners set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('delete from app.partners'))).rejects.toMatchObject({ code: '42501' })

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(`select name, phone from app.partners order by phone nulls last, id`)
  })
  expect(seenByA.rows).toEqual([
    { name: 'Mora Transfer', phone: '+385911110379' },
    { name: 'Mora Transfer', phone: null },
  ])
})

it('refuses a blank name, surrounding spaces, a long note, and a phone or email that fails the Driver check', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['', null, null, null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, [' Mora', null, null, null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['A'.repeat(201), null, null, null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Mora', ' +385911110379', null, null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Mora', '1'.repeat(41), null, null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Mora', null, 'not an email', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Mora', null, null, ` ${'n'.repeat(10)}`]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Mora', null, null, 'n'.repeat(2001)]))).rejects.toMatchObject({ code: '23514' })
})
