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

const tenantA = 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1'
const tenantB = 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2'

beforeAll(async () => {
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.vehicles where tenant_id in ($1, $2)', [tenantA, tenantB])
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
  insert into app.vehicles (
    registration_plate, kind, registration_expires_on, technical_inspection_expires_on, insurance_expires_on
  ) values ($1, $2, $3, $4, $5)
`

it('forces row level security on app.vehicles', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'vehicles'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A vehicles', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['DU123AB', 'fixed', '2027-06-01', '2028-01-31', '2029-03-03'])
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select registration_plate from app.vehicles')
    const updated = await client.query(`update app.vehicles set kind = 'occasional'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.vehicles (tenant_id, registration_plate, kind, registration_expires_on, technical_inspection_expires_on, insurance_expires_on)
       values ($1, 'ZG111AA', 'occasional', '2027-06-01', '2028-01-31', '2029-03-03')`,
      [tenantA],
    ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('update app.vehicles set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('delete from app.vehicles'))).rejects.toMatchObject({ code: '42501' })

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(`select registration_plate, kind, registration_expires_on::text as registration from app.vehicles`)
  })
  expect(seenByA.rows).toEqual([{
    registration_plate: 'DU123AB',
    kind: 'fixed',
    registration: '2027-06-01',
  }])
})

it('stores a calendar date and refuses an empty plate, spaces in the stored plate, a long plate, and an unknown kind', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['', 'fixed', '2027-06-01', '2028-01-31', '2029-03-03']))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['DU 123 AB', 'fixed', '2027-06-01', '2028-01-31', '2029-03-03']))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['du123ab', 'fixed', '2027-06-01', '2028-01-31', '2029-03-03']))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['A'.repeat(17), 'fixed', '2027-06-01', '2028-01-31', '2029-03-03']))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['DU999ZZ', 'own', '2027-06-01', '2028-01-31', '2029-03-03']))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['DU999ZZ', 'fixed', '2026-02-31', '2028-01-31', '2029-03-03']))).rejects.toMatchObject({ code: '22008' })
  await expect(withTenant(tenantA, client =>
    client.query(
      `insert into app.vehicles (registration_plate, kind, registration_expires_on, technical_inspection_expires_on, insurance_expires_on, description)
       values ('DU888YY', 'fixed', '2027-06-01', '2028-01-31', '2029-03-03', $1)`,
      ['A'.repeat(121)],
    ))).rejects.toMatchObject({ code: '23514' })
})

it('refuses a second live plate in the Tenant, and allows the plate after archive', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['ST111AA', 'fixed', '2027-06-01', '2028-01-31', '2029-03-03'])
  })

  await expect(withTenant(tenantA, client =>
    client.query(insert, ['ST111AA', 'occasional', '2027-06-01', '2028-01-31', '2029-03-03']))).rejects.toMatchObject({ code: '23505' })

  await withTenant(tenantA, async (client) => {
    await client.query(`update app.vehicles set archived_at = now() where registration_plate = 'ST111AA'`)
    await client.query(insert, ['ST111AA', 'occasional', '2027-06-01', '2028-01-31', '2029-03-03'])
  })

  const live = await withTenant(tenantA, async (client) => {
    return client.query(
      `select registration_plate, kind from app.vehicles where registration_plate = 'ST111AA' and archived_at is null`,
    )
  })
  expect(live.rows).toEqual([{ registration_plate: 'ST111AA', kind: 'occasional' }])
})
