import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * RLS seam: a fake cannot prove Tenant A is hidden from Tenant B, or that a
 * member of Tenant B cannot be linked while the session is Tenant A.
 * The observation is the rows and the errors, not the policy text.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const authUrl = process.env.AUTH_DATABASE_URL
if (!authUrl)
  throw new Error('AUTH_DATABASE_URL is required (the transferpro_auth role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })
const authPool = new pg.Pool({ connectionString: authUrl })

const tenantA = 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1'
const tenantB = 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2'
const driverA = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4'
const driverB = 'd3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3'
const dispatcherA = 'd5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5'

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('delete from app.drivers where tenant_id in ($1, $2)', [tenantA, tenantB])
    await auth.query('begin')
    await auth.query('delete from auth.member where organization_id = any($1::text[])', [[tenantA, tenantB]])
    await auth.query('delete from auth.organization where id = any($1::text[])', [[tenantA, tenantB]])
    await auth.query('delete from auth."user" where id = any($1::text[])', [[driverA, driverB, dispatcherA]])
    await auth.query(
      `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Ana', 'drv-a@example.test', true, now(), now()),
              ($2, 'Boris', 'drv-b@example.test', true, now(), now()),
              ($3, 'Dino', 'drv-disp@example.test', true, now(), now())`,
      [driverA, driverB, dispatcherA],
    )
    await auth.query(
      `insert into auth.organization (id, name, slug, created_at)
       values ($1, 'Drivers A', 'drv-a', now()),
              ($2, 'Drivers B', 'drv-b', now())`,
      [tenantA, tenantB],
    )
    await auth.query(
      `insert into auth.member (id, organization_id, user_id, role, created_at)
       values ('drv-member-a', $1, $2, 'driver', now()),
              ('drv-member-b', $3, $4, 'driver', now()),
              ('drv-member-disp', $1, $5, 'dispatcher', now())`,
      [tenantA, driverA, tenantB, driverB, dispatcherA],
    )
    await auth.query('commit')
  }
  catch (error) {
    await auth.query('rollback')
    throw error
  }
  finally {
    owner.release()
    auth.release()
  }
})

afterAll(async () => {
  await pool.end()
  await ownerPool.end()
  await authPool.end()
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
  insert into app.drivers (
    name, kind, phone, driving_licence_expires_on, transport_licence_expires_on, member_user_id
  ) values ($1, $2, $3, $4, $5, $6)
`

it('forces row level security on app.drivers', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'drivers'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A drivers', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['Marko Marić', 'own', '+385911112222', '2027-06-01', '2028-01-31', null])
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select name from app.drivers')
    const updated = await client.query(`update app.drivers set name = 'Changed'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.drivers (tenant_id, name, kind, phone, driving_licence_expires_on, transport_licence_expires_on)
       values ($1, 'Hotel B', 'external', '+385911110000', '2027-06-01', '2028-01-31')`,
      [tenantA],
    ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('update app.drivers set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('delete from app.drivers'))).rejects.toMatchObject({ code: '42501' })

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(`select name, kind, driving_licence_expires_on::text as driving, must_accept from app.drivers`)
  })
  expect(seenByA.rows).toEqual([{
    name: 'Marko Marić',
    kind: 'own',
    driving: '2027-06-01',
    must_accept: false,
  }])
})

it('stores a calendar date and refuses an empty name, an untrimmed phone, a long phone, and an unknown kind', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['', 'own', '+385911112222', '2027-06-01', '2028-01-31', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Marko', 'own', ' +385911112222', '2027-06-01', '2028-01-31', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Marko', 'own', '1'.repeat(41), '2027-06-01', '2028-01-31', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Marko', 'partner', '+385911112222', '2027-06-01', '2028-01-31', null]))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Marko', 'own', '+385911112222', '2026-02-31', '2028-01-31', null]))).rejects.toMatchObject({ code: '22008' })
})

it('links a driver of this Tenant, and refuses another Tenant, a non-driver, and a second Driver for the same member', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Van', 'external', '+385911110001', '2027-06-01', '2028-01-31', driverB]))).rejects.toMatchObject({ code: '23514' })

  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Ured', 'own', '+385911110002', '2027-06-01', '2028-01-31', dispatcherA]))).rejects.toMatchObject({ code: '23514' })

  await withTenant(tenantA, async (client) => {
    await client.query(insert, ['Ana', 'own', '+385911110003', '2027-06-01', '2028-01-31', driverA])
    await client.query(insert, ['Bez', 'external', '+385911110004', '2027-07-01', '2028-02-01', null])
  })

  await expect(withTenant(tenantA, client =>
    client.query(insert, ['Druga', 'own', '+385911110005', '2027-06-01', '2028-01-31', driverA]))).rejects.toMatchObject({ code: '23505' })

  const linked = await withTenant(tenantA, async (client) => {
    return client.query(
      `select name, member_user_id from app.drivers where member_user_id is not null order by name`,
    )
  })
  expect(linked.rows).toEqual([{ name: 'Ana', member_user_id: driverA }])
})
