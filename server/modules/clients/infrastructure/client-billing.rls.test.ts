import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * Billing details on their own (ADR-0051). A route test cannot show that
 * the composite foreign key refuses another Tenant's Client, that a second
 * row for the same Client is refused, or that the app role has no DELETE
 * grant. The observation is the rows and the error codes. app.clients is
 * not altered.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })

const tenantA = 'a437a437-0437-4437-8437-000000000001'
const tenantB = 'b437b437-0437-4437-8437-000000000002'

beforeAll(async () => {
  // The owner bypasses RLS and clears the fixture tenants. The app role's policy would leave a live row.
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.client_billing_details where tenant_id in ($1, $2)', [tenantA, tenantB])
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

async function insertClient(tenantId: string, name: string): Promise<string> {
  const inserted = await withTenant(tenantId, client => client.query<{ id: string }>(
    `insert into app.clients (name, kind) values ($1, 'hotel') returning id`,
    [name],
  ))
  const id = inserted.rows[0]?.id
  if (!id)
    throw new Error('missing client')
  return id
}

const insertSql = `insert into app.client_billing_details
  (client_id, legal_name, country, oib, vat_id, address, guest_name_on_invoice, version, data_changed_at, data_changed_by)
  values ($1, $2, $3, $4, $5, $6, $7, 1, now(), 'member-a')`

it('forces row level security on app.client_billing_details and grants no DELETE', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'client_billing_details'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])

    const grants = await client.query<{ grantee: string, privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'app' and table_name = 'client_billing_details'
       order by grantee, privilege_type`,
    )
    expect(grants.rows).toEqual([
      { grantee: 'transferpro_app', privilege_type: 'INSERT' },
      { grantee: 'transferpro_app', privilege_type: 'SELECT' },
      { grantee: 'transferpro_app', privilege_type: 'UPDATE' },
    ])

    const clients = await client.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'app' and table_name = 'clients'
       order by column_name`,
    )
    expect(clients.rows.map(row => row.column_name)).toEqual([
      'data_changed_at',
      'data_changed_by',
      'id',
      'kind',
      'name',
      'tenant_id',
      'version',
    ])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A billing details, and the app role cannot delete them', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Jadran')
  await withTenant(tenantA, client => client.query(insertSql, [
    clientA,
    'Hotel Jadran d.o.o.',
    'HR',
    '12345678903',
    null,
    'Obala 1, Split',
    false,
  ]))

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select legal_name from app.client_billing_details')
    const updated = await client.query(`update app.client_billing_details set address = 'Changed'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client => client.query(
    `insert into app.client_billing_details
       (tenant_id, client_id, legal_name, country, oib, address, version, data_changed_at, data_changed_by)
     values ($1, $2, 'Hotel Jadran d.o.o.', 'HR', '12345678903', 'Obala 1, Split', 1, now(), 'member-b')`,
    [tenantA, clientA],
  ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query(
    'update app.client_billing_details set tenant_id = $1',
    [tenantB],
  ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('delete from app.client_billing_details'))).rejects.toMatchObject({ code: '42501' })

  const seenByA = await withTenant(tenantA, client => client.query(
    'select country, version from app.client_billing_details',
  ))
  expect(seenByA.rows).toEqual([{ country: 'HR', version: 1 }])
})

it('refuses billing details that point at another Tenant\'s Client, and a second row for the same Client', async () => {
  const clientB = await insertClient(tenantB, 'Hotel Park')
  await expect(withTenant(tenantA, client => client.query(insertSql, [
    clientB,
    'Tuđi naziv',
    'DE',
    null,
    null,
    'Hauptstr. 1',
    false,
  ]))).rejects.toMatchObject({ code: '23503' })

  const clientA = await insertClient(tenantA, 'Agencija Sunce')
  await withTenant(tenantA, client => client.query(insertSql, [
    clientA,
    'Agencija Sunce d.o.o.',
    'DE',
    null,
    'DE123',
    'Ulica 1',
    false,
  ]))
  await expect(withTenant(tenantA, client => client.query(
    'update app.client_billing_details set client_id = $1 where client_id = $2',
    [clientB, clientA],
  ))).rejects.toMatchObject({ code: '23503' })
  await expect(withTenant(tenantA, client => client.query(insertSql, [
    clientA,
    'Drugi naziv',
    'DE',
    null,
    null,
    'Ulica 2',
    false,
  ]))).rejects.toMatchObject({ code: '23505' })
})

it('refuses a bad OIB, a Croatian Client without one, an unknown country, an untrimmed name, and a version without an author', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Verzija')
  await expect(withTenant(tenantA, client => client.query(insertSql, [
    clientA,
    'Hotel Verzija d.o.o.',
    'HR',
    '12345678901',
    null,
    'Obala 2',
    false,
  ]))).rejects.toMatchObject({ code: '23514', constraint: 'client_billing_details_oib' })
  await expect(withTenant(tenantA, client => client.query(insertSql, [
    clientA,
    'Hotel Verzija d.o.o.',
    'HR',
    null,
    null,
    'Obala 2',
    false,
  ]))).rejects.toMatchObject({ code: '23514', constraint: 'client_billing_details_oib' })
  await expect(withTenant(tenantA, client => client.query(insertSql, [
    clientA,
    'Hotel Verzija d.o.o.',
    'ZZ',
    null,
    null,
    'Obala 2',
    false,
  ]))).rejects.toMatchObject({ code: '23514', constraint: 'client_billing_details_country' })
  await expect(withTenant(tenantA, client => client.query(insertSql, [
    clientA,
    ' Hotel Verzija d.o.o.',
    'DE',
    null,
    null,
    'Obala 2',
    false,
  ]))).rejects.toMatchObject({ code: '23514', constraint: 'client_billing_details_legal_name' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_billing_details (client_id, legal_name, country, address, version)
     values ($1, 'Hotel Verzija d.o.o.', 'DE', 'Obala 2', 1)`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'client_billing_details_data_change' })

  const kept = await withTenant(tenantA, client => client.query(
    `insert into app.client_billing_details
       (client_id, legal_name, country, address, guest_name_on_invoice, version, data_changed_at, data_changed_by)
     values ($1, 'Hotel Verzija d.o.o.', 'DE', 'Obala 2', false, 1, now(), 'member-a')
     returning guest_name_on_invoice, version`,
    [clientA],
  ))
  expect(kept.rows).toEqual([{ guest_name_on_invoice: false, version: 1 }])
})

it('refuses a billing version that records a time and a null member', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Bez Autora')
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_billing_details
       (client_id, legal_name, country, address, version, data_changed_at, data_changed_by)
     values ($1, 'Hotel Bez Autora d.o.o.', 'DE', 'Obala 3', 1, now(), null)`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'client_billing_details_data_change' })
})
