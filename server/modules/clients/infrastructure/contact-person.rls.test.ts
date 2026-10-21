import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * The contact-person table on its own (ADR-0049). A route test cannot show
 * that the composite foreign key refuses another Tenant's Client, or that
 * a live contact person cannot be deleted. The observation is the rows and the error codes.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })

const tenantA = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const tenantB = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'

beforeAll(async () => {
  // The owner bypasses RLS and clears the fixture tenants. The app role's policy would leave a live row.
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.client_contact_persons where tenant_id in ($1, $2)', [tenantA, tenantB])
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

it('forces row level security on app.client_contact_persons', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'client_contact_persons'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A contact persons, and a live contact person cannot be deleted', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Jadran')
  await withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, phone)
     values ($1, 'Ana Booking', '+385911110364')`,
    [clientA],
  ))

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select name from app.client_contact_persons')
    const updated = await client.query(`update app.client_contact_persons set name = 'Changed'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client => client.query(
    `insert into app.client_contact_persons (tenant_id, client_id, name, phone)
     values ($1, $2, 'Ana Booking', '+385911110364')`,
    [tenantA, clientA],
  ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query(
    'update app.client_contact_persons set tenant_id = $1',
    [tenantB],
  ))).rejects.toMatchObject({ code: '42501' })

  // A live person has no removal instant, so the retention policy removes nothing.
  const deleted = await withTenant(tenantA, client => client.query('delete from app.client_contact_persons'))
  expect(deleted.rowCount).toBe(0)

  const seenByA = await withTenant(tenantA, client => client.query(
    'select name, phone, version, data_changed_at, data_changed_by from app.client_contact_persons',
  ))
  expect(seenByA.rows).toEqual([{
    name: 'Ana Booking',
    phone: '+385911110364',
    version: 0,
    data_changed_at: null,
    data_changed_by: null,
  }])
})

it('refuses a contact person that points at another Tenant\'s Client', async () => {
  const clientB = await insertClient(tenantB, 'Hotel Park')
  // The row would belong to Tenant A, and the Client belongs to Tenant B.
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, email)
     values ($1, 'Iva Accounts', 'booking@example.test')`,
    [clientB],
  ))).rejects.toMatchObject({ code: '23503' })

  const clientA = await insertClient(tenantA, 'Agencija Sunce')
  await withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, email)
     values ($1, 'Iva Accounts', 'booking@example.test')`,
    [clientA],
  ))
  await expect(withTenant(tenantA, client => client.query(
    'update app.client_contact_persons set client_id = $1 where client_id = $2',
    [clientB, clientA],
  ))).rejects.toMatchObject({ code: '23503' })
})

it('refuses an unreachable contact, a bad name, a bad email, and a version without an author', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Verzija')
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name) values ($1, 'Ana Booking')`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, phone) values ($1, ' Ana', '+385911110364')`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, email) values ($1, 'Ana Booking', 'not an email')`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, phone, version)
     values ($1, 'Ana Booking', '+385911110364', 1)`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514' })

  const kept = await withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, role, phone)
     values ($1, $2, 'booking', '+385911110364')
     returning version, data_changed_at, data_changed_by`,
    [clientA, 'A'.repeat(200)],
  ))
  expect(kept.rows).toEqual([{ version: 0, data_changed_at: null, data_changed_by: null }])
})

// `data_changed_by <> ''` is unknown when the member is null, and a CHECK
// accepts unknown. A version that names a time and no member must still fail.
it('refuses a contact person version that records a time and a null member', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Bez Autora')
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, phone, version, data_changed_at, data_changed_by)
     values ($1, 'Ana Booking', '+385911110364', 1, now(), null)`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'client_contact_persons_data_change' })

  await withTenant(tenantA, client => client.query(
    `insert into app.client_contact_persons (client_id, name, phone)
     values ($1, 'Ana Booking', '+385911110364')`,
    [clientA],
  ))
  await expect(withTenant(tenantA, client => client.query(
    `update app.client_contact_persons
     set version = 1, data_changed_at = now(), data_changed_by = null
     where client_id = $1`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'client_contact_persons_data_change' })
})
