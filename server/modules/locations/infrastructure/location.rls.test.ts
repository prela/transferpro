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

const tenantA = 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'
const tenantB = 'c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2'

beforeAll(async () => {
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.locations where tenant_id in ($1, $2)', [tenantA, tenantB])
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

const insert = `insert into app.locations (name, kind, address) values ($1, $2, $3)`

it('forces row level security on app.locations', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'locations'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A locations', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['Zračna luka Dubrovnik', 'airport', 'Dobrota bb'])
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select name from app.locations')
    const updated = await client.query(`update app.locations set kind = 'hotel'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.locations (tenant_id, name, kind) values ($1, 'Hotel Park', 'hotel')`,
      [tenantA],
    ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('update app.locations set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('delete from app.locations'))).rejects.toMatchObject({ code: '42501' })

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(`select name, kind, address from app.locations`)
  })
  expect(seenByA.rows).toEqual([{
    name: 'Zračna luka Dubrovnik',
    kind: 'airport',
    address: 'Dobrota bb',
  }])
})

it('refuses an empty name, surrounding spaces, a long name, an unknown kind, and a long or blank address', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['', 'airport', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['  Hotel  ', 'hotel', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['A'.repeat(201), 'hotel', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Hotel Park', 'stop', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Hotel Park', 'hotel', '  Put 1  ']))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Hotel Park', 'hotel', '']))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Hotel Park', 'hotel', 'A'.repeat(201)]))).rejects.toMatchObject({ code: '23514' })
})

it('keeps an archived Location readable by id inside the Tenant', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['Hotel Excelsior', 'hotel', null])
    await client.query(`update app.locations set archived_at = now() where name = 'Hotel Excelsior'`)
  })

  const seen = await withTenant(tenantA, async (client) => {
    return client.query(
      `select name, archived_at is not null as archived from app.locations where name = 'Hotel Excelsior'`,
    )
  })
  expect(seen.rows).toEqual([{ name: 'Hotel Excelsior', archived: true }])
})
