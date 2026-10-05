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

const tenantA = 'f1580001-0000-4000-8000-000000000058'
const tenantB = 'f1580002-0000-4000-8000-000000000058'
const driverA = 'f1580011-0000-4000-8000-000000000058'
const driverB = 'f1580012-0000-4000-8000-000000000058'
const vehicleA = 'f1580021-0000-4000-8000-000000000058'
const vehicleB = 'f1580022-0000-4000-8000-000000000058'

beforeAll(async () => {
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.roster where tenant_id in ($1, $2)', [tenantA, tenantB])
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

const insert = `
  insert into app.roster (roster_date, driver_id, vehicle_id)
  values ($1, $2, $3)
`

it('forces row level security on app.roster', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'roster'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A roster rows, and Tenant A can delete its own', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['2026-10-05', driverA, vehicleA])
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select driver_id from app.roster')
    const updated = await client.query('update app.roster set vehicle_id = $1', [vehicleB])
    const deleted = await client.query('delete from app.roster')
    return { rows: selected.rows, updated: updated.rowCount, deleted: deleted.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)
  expect(seenByB.deleted).toBe(0)

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.roster (tenant_id, roster_date, driver_id, vehicle_id)
       values ($1, '2026-10-05', $2, $3)`,
      [tenantA, driverB, vehicleB],
    ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('update app.roster set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })

  const removed = await withTenant(tenantA, async (client) => {
    const deleted = await client.query('delete from app.roster')
    const selected = await client.query('select driver_id from app.roster')
    return { deleted: deleted.rowCount, rows: selected.rows }
  })
  expect(removed.deleted).toBe(1)
  expect(removed.rows).toEqual([])
})

it('allows one vehicle and one driver per day, and the same pair on another day', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['2026-10-05', driverA, vehicleA])
  })

  await expect(withTenant(tenantA, client =>
    client.query(insert, ['2026-10-05', driverB, vehicleA]))).rejects.toMatchObject({ code: '23505' })

  await expect(withTenant(tenantA, client =>
    client.query(insert, ['2026-10-05', driverA, vehicleB]))).rejects.toMatchObject({ code: '23505' })

  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['2026-10-06', driverA, vehicleA])
  })

  const seen = await withTenant(tenantA, async (client) => {
    return client.query(`select roster_date::text as day, driver_id, vehicle_id from app.roster order by roster_date`)
  })
  expect(seen.rows).toEqual([
    { day: '2026-10-05', driver_id: driverA, vehicle_id: vehicleA },
    { day: '2026-10-06', driver_id: driverA, vehicle_id: vehicleA },
  ])

  await expect(withTenant(tenantA, client =>
    client.query(insert, ['2026-02-31', driverB, vehicleB]))).rejects.toMatchObject({ code: '22008' })
})

it('refuses an insert when the session has no tenant', async () => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    // No app.tenant_id: the default is null, and the policy check fails closed.
    await expect(client.query(insert, ['2026-10-07', driverA, vehicleA])).rejects.toMatchObject({ code: '42501' })
    await client.query('rollback')
  }
  finally {
    client.release()
  }
})
