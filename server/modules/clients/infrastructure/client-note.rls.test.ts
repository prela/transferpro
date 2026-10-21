import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * The Client note table on its own (ADR-0049). A route test cannot show
 * that the composite foreign key refuses another Tenant's Client, that
 * a second row for the same Client is refused, or that the app role has
 * no DELETE grant. The observation is the rows and the error codes.
 * app.clients is not altered.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })

const tenantA = 'a366a366-0366-4366-8366-000000000001'
const tenantB = 'b366b366-0366-4366-8366-000000000002'

beforeAll(async () => {
  // The owner bypasses RLS and clears the fixture tenants. The app role's policy would leave a live row.
  const owner = await ownerPool.connect()
  try {
    await owner.query('delete from app.client_notes where tenant_id in ($1, $2)', [tenantA, tenantB])
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

it('forces row level security on app.client_notes and grants no DELETE', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'client_notes'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])

    const grants = await client.query<{ grantee: string, privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'app' and table_name = 'client_notes'
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

it('tenant B cannot read or change Tenant A notes, and the app role cannot delete one', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Jadran')
  await withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note, version, data_changed_at, data_changed_by)
     values ($1, 'Gosti se čekaju na izlazu.', 1, now(), 'member-a')`,
    [clientA],
  ))

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select note from app.client_notes')
    const updated = await client.query(`update app.client_notes set note = 'Changed'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  await expect(withTenant(tenantB, client => client.query(
    `insert into app.client_notes (tenant_id, client_id, note, version, data_changed_at, data_changed_by)
     values ($1, $2, 'Gosti se čekaju na izlazu.', 1, now(), 'member-b')`,
    [tenantA, clientA],
  ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query(
    'update app.client_notes set tenant_id = $1',
    [tenantB],
  ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('delete from app.client_notes'))).rejects.toMatchObject({ code: '42501' })

  const seenByA = await withTenant(tenantA, client => client.query(
    'select note, version from app.client_notes',
  ))
  expect(seenByA.rows).toEqual([{ note: 'Gosti se čekaju na izlazu.', version: 1 }])
})

it('refuses a note that points at another Tenant\'s Client, and a second row for the same Client', async () => {
  const clientB = await insertClient(tenantB, 'Hotel Park')
  // The row would belong to Tenant A, and the Client belongs to Tenant B.
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note, version, data_changed_at, data_changed_by)
     values ($1, 'Tuđa napomena', 1, now(), 'member-a')`,
    [clientB],
  ))).rejects.toMatchObject({ code: '23503' })

  const clientA = await insertClient(tenantA, 'Agencija Sunce')
  await withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note, version, data_changed_at, data_changed_by)
     values ($1, 'Naša napomena', 1, now(), 'member-a')`,
    [clientA],
  ))
  await expect(withTenant(tenantA, client => client.query(
    'update app.client_notes set client_id = $1 where client_id = $2',
    [clientB, clientA],
  ))).rejects.toMatchObject({ code: '23503' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note, version, data_changed_at, data_changed_by)
     values ($1, 'Druga napomena', 1, now(), 'member-a')`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23505' })
})

it('refuses an untrimmed note, an empty string, a note past 2000 characters, and a version without an author', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Verzija')
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note) values ($1, ' Na izlazu')`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note) values ($1, '')`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note) values ($1, $2)`,
    [clientA, 'A'.repeat(2001)],
  ))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note, version) values ($1, 'Na izlazu', 1)`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514' })

  const kept = await withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note, version, data_changed_at, data_changed_by)
     values ($1, $2, 1, now(), 'member-a')
     returning version, note`,
    [clientA, 'A'.repeat(2000)],
  ))
  expect(kept.rows).toEqual([{ version: 1, note: 'A'.repeat(2000) }])

  const cleared = await withTenant(tenantA, client => client.query(
    `update app.client_notes set note = null, version = 2, data_changed_at = now(), data_changed_by = 'member-a'
     where client_id = $1
     returning note, version`,
    [clientA],
  ))
  expect(cleared.rows).toEqual([{ note: null, version: 2 }])
})

// `data_changed_by <> ''` is unknown when the member is null, and a CHECK
// accepts unknown. A version that names a time and no member must still fail.
it('refuses a Client note version that records a time and a null member', async () => {
  const clientA = await insertClient(tenantA, 'Hotel Bez Autora')
  await expect(withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note, version, data_changed_at, data_changed_by)
     values ($1, 'Na izlazu', 1, now(), null)`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'client_notes_data_change' })

  await withTenant(tenantA, client => client.query(
    `insert into app.client_notes (client_id, note) values ($1, 'Na izlazu')`,
    [clientA],
  ))
  await expect(withTenant(tenantA, client => client.query(
    `update app.client_notes
     set version = 1, data_changed_at = now(), data_changed_by = null
     where client_id = $1`,
    [clientA],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'client_notes_data_change' })
})
