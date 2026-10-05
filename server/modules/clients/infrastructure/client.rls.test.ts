import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * RLS seam: a fake cannot prove Tenant A is hidden from Tenant B.
 * The observation is the rows each session gets back, not the policy text.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'

beforeAll(async () => {
  // transferpro_app has no DELETE on app.clients. The owner bypasses RLS and clears the fixture tenants.
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.clients where tenant_id in ($1, $2)', [tenantA, tenantB])
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

it('forces row level security on app.clients', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'clients'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A clients', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(
      `insert into app.clients (name, kind) values ('Agencija Mora', 'agency')`,
    )
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select name, kind from app.clients')
    const updated = await client.query(`update app.clients set name = 'Changed'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })

  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.clients (tenant_id, name, kind) values ($1, 'Hotel B', 'hotel')`,
      [tenantA],
    ))).rejects.toMatchObject({ code: '42501' })

  // WITH CHECK refuses a row whose tenant_id is no longer this session's Tenant.
  await expect(withTenant(tenantA, client => client.query('update app.clients set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })

  // There is no delete route, and the app role is not granted DELETE.
  await expect(withTenant(tenantA, client => client.query('delete from app.clients'))).rejects.toMatchObject({ code: '42501' })

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query('select name, kind from app.clients')
  })
  expect(seenByA.rows).toEqual([{ name: 'Agencija Mora', kind: 'agency' }])
})

it('refuses an empty name, an untrimmed name, a name longer than 200 characters, and an unknown kind', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.clients (name, kind) values ('', 'agency')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.clients (name, kind) values (' Mora', 'agency')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.clients (name, kind) values ($1, 'hotel')`, ['A'.repeat(201)]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.clients (name, kind) values ('Mora', 'partner')`))).rejects.toMatchObject({ code: '23514' })

  const kept = await withTenant(tenantA, async (client) => {
    await client.query(`insert into app.clients (name, kind) values ($1, 'individual')`, ['A'.repeat(200)])
    return client.query(`select kind from app.clients where name = $1`, ['A'.repeat(200)])
  })
  expect(kept.rows).toEqual([{ kind: 'individual' }])
})
