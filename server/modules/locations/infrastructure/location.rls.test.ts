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
    return client.query(`select name, kind, address, iata from app.locations`)
  })
  expect(seenByA.rows).toEqual([{
    name: 'Zračna luka Dubrovnik',
    kind: 'airport',
    address: 'Dobrota bb',
    iata: null,
  }])
})

it('stores an airport code and hides it from the other Tenant', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(
      `insert into app.locations (name, kind, iata) values ('Zračna luka Split', 'airport', 'SPU')`,
    )
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select iata from app.locations')
    const updated = await client.query(`update app.locations set iata = 'DBV'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(`select iata from app.locations where name = 'Zračna luka Split'`)
  })
  expect(seenByA.rows).toEqual([{ iata: 'SPU' }])
})

it('refuses a code that is not three uppercase letters, and a code on a hotel', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, iata) values ('Zračna luka Pula', 'airport', 'dbv')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, iata) values ('Zračna luka Pula', 'airport', 'DB')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, iata) values ('Hotel Park', 'hotel', 'DBV')`))).rejects.toMatchObject({ code: '23514' })
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

it('tenant B cannot read or change Tenant A place references', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(
      `insert into app.locations (name, kind, address, place_provider, place_ref)
       values ('Villa Rosa', 'address', 'Put 1', 'google', 'ChIJsecret')`,
    )
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select place_provider, place_ref from app.locations')
    const updated = await client.query(`update app.locations set place_ref = 'ChIJother'`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(
      `select place_provider, place_ref from app.locations where name = 'Villa Rosa'`,
    )
  })
  expect(seenByA.rows).toEqual([{ place_provider: 'google', place_ref: 'ChIJsecret' }])
})

it('refuses a place reference without its pair or without an address', async () => {
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, address, place_provider) values ('Hotel Park', 'hotel', 'Put 1', 'google')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, address, place_ref) values ('Hotel Park', 'hotel', 'Put 1', 'ChIJonly')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, place_provider, place_ref) values ('Hotel Park', 'hotel', 'google', 'ChIJbare')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, address, place_provider, place_ref) values ('Hotel Park', 'hotel', 'Put 1', 'photon', 'ChIJother')`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, address, place_provider, place_ref) values ('Hotel Park', 'hotel', 'Put 1', 'google', '')`))).rejects.toMatchObject({ code: '23514' })
})

it('stores a check time only beside a place reference, and hides that column from the other Tenant', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(
      `insert into app.locations (name, kind, address, place_provider, place_ref, place_ref_checked_at)
       values ('Hotel Check', 'hotel', 'Put 2', 'google', 'ChIJchecked', now())`,
    )
    await client.query(
      `insert into app.locations (name, kind, address, place_provider, place_ref)
       values ('Hotel Due', 'hotel', 'Put 3', 'google', 'ChIJdue')`,
    )
  })

  await expect(withTenant(tenantA, client =>
    client.query(
      `insert into app.locations (name, kind, place_ref_checked_at)
       values ('Hotel Bare', 'hotel', now())`,
    ))).rejects.toMatchObject({ code: '23514' })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select place_ref_checked_at from app.locations')
    const updated = await client.query(`update app.locations set place_ref_checked_at = now()`)
    return { rows: selected.rows, updated: updated.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(
      `select name, place_ref_checked_at is not null as checked
       from app.locations
       where name in ('Hotel Check', 'Hotel Due')
       order by name`,
    )
  })
  expect(seenByA.rows).toEqual([
    { name: 'Hotel Check', checked: true },
    { name: 'Hotel Due', checked: false },
  ])
})

// Last in this file. It leaves a Location on Tenant B, and an earlier test
// updates every Location that Tenant can see.
it('keeps one active airport code per Tenant, and another Tenant may use the same code', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(
      `insert into app.locations (name, kind, iata) values ('Zračna luka Zadar', 'airport', 'ZAD')`,
    )
  })

  await expect(withTenant(tenantA, client =>
    client.query(`insert into app.locations (name, kind, iata) values ('Zračna luka Zadar 2', 'airport', 'ZAD')`))).rejects.toMatchObject({ code: '23505' })

  await withTenant(tenantA, async (client) => {
    await client.query(`update app.locations set archived_at = now() where iata = 'ZAD'`)
  })
  await withTenant(tenantA, async (client) => {
    await client.query(
      `insert into app.locations (name, kind, iata) values ('Zračna luka Zadar nova', 'airport', 'ZAD')`,
    )
  })

  await withTenant(tenantB, async (client) => {
    await client.query(
      `insert into app.locations (name, kind, iata) values ('Zračna luka Zadar B', 'airport', 'ZAD')`,
    )
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    return client.query(`select name from app.locations where iata = 'ZAD'`)
  })
  expect(seenByB.rows).toEqual([{ name: 'Zračna luka Zadar B' }])

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(
      `select name from app.locations where iata = 'ZAD' and archived_at is null`,
    )
  })
  expect(seenByA.rows).toEqual([{ name: 'Zračna luka Zadar nova' }])
})
