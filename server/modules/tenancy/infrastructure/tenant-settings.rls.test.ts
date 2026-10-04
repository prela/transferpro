import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')

/**
 * RLS seam: a fake cannot prove Tenant A is hidden from Tenant B.
 * The observation is the rows each session gets back, not the policy text.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const pool = new pg.Pool({ connectionString: databaseUrl })

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const tenantC = '33333333-3333-4333-8333-333333333333'
const tenantD = '44444444-4444-4444-8444-444444444444'

beforeAll(async () => {
  const client = await pool.connect()
  client.release()
  // One settings row per tenant. Drop the fixtures so a second run can insert again.
  for (const tenantId of [tenantA, tenantB, tenantC, tenantD]) {
    await withTenant(tenantId, async (session) => {
      await session.query('delete from app.tenant_settings')
    })
  }
})

afterAll(async () => {
  await pool.end()
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

it('tenant B cannot read or write Tenant A settings', async () => {
  await withTenant(tenantA, async (client) => {
    await client.query(
      'insert into app.tenant_settings (default_locale, time_zone) values ($1, $2)',
      ['hr', 'Europe/Zagreb'],
    )
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const selected = await client.query('select default_locale, time_zone from app.tenant_settings')
    const updated = await client.query(
      'update app.tenant_settings set default_locale = $1',
      ['en'],
    )
    return { rows: selected.rows, updated: updated.rowCount }
  })

  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)

  const seenByA = await withTenant(tenantA, async (client) => {
    const selected = await client.query('select default_locale, time_zone from app.tenant_settings')
    return selected.rows
  })

  expect(seenByA).toEqual([{ default_locale: 'hr', time_zone: 'Europe/Zagreb' }])
})

it('a settings row that omits the waits stores 90 minutes at an airport and 25 elsewhere', async () => {
  const seen = await withTenant(tenantC, async (client) => {
    await client.query('delete from app.tenant_settings')
    await client.query(
      `insert into app.tenant_settings (default_locale, time_zone) values ('hr', 'Europe/Zagreb')`,
    )
    return client.query(
      'select airport_wait_minutes, elsewhere_wait_minutes, time_zone from app.tenant_settings',
    )
  })

  expect(seen.rows).toEqual([{
    airport_wait_minutes: 90,
    elsewhere_wait_minutes: 25,
    time_zone: 'Europe/Zagreb',
  }])
})

it('another tenant cannot read or write the waits or the time zone', async () => {
  await withTenant(tenantC, async (client) => {
    await client.query('delete from app.tenant_settings')
    await client.query(
      `insert into app.tenant_settings (default_locale, time_zone, airport_wait_minutes, elsewhere_wait_minutes)
       values ('hr', 'Europe/Zagreb', 120, 40)`,
    )
  })

  const seenByD = await withTenant(tenantD, async (client) => {
    const selected = await client.query(
      'select airport_wait_minutes, elsewhere_wait_minutes, time_zone from app.tenant_settings',
    )
    const updatedWait = await client.query('update app.tenant_settings set airport_wait_minutes = 15')
    const updatedZone = await client.query(`update app.tenant_settings set time_zone = 'Europe/Berlin'`)
    return { rows: selected.rows, updatedWait: updatedWait.rowCount, updatedZone: updatedZone.rowCount }
  })

  expect(seenByD.rows).toEqual([])
  expect(seenByD.updatedWait).toBe(0)
  expect(seenByD.updatedZone).toBe(0)

  const seenByC = await withTenant(tenantC, async (client) => {
    return client.query(
      'select airport_wait_minutes, elsewhere_wait_minutes, time_zone from app.tenant_settings',
    )
  })

  expect(seenByC.rows).toEqual([{
    airport_wait_minutes: 120,
    elsewhere_wait_minutes: 40,
    time_zone: 'Europe/Zagreb',
  }])
})

it('refuses a wait outside 1 to 1440 minutes and a time zone name that is empty or longer than 64 characters', async () => {
  await withTenant(tenantC, async (client) => {
    await client.query('delete from app.tenant_settings')
    await client.query(
      `insert into app.tenant_settings (default_locale, time_zone) values ('hr', 'Europe/Zagreb')`,
    )
  })

  await expect(withTenant(tenantC, async client =>
    client.query('update app.tenant_settings set airport_wait_minutes = 0'))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantC, async client =>
    client.query('update app.tenant_settings set elsewhere_wait_minutes = 1441'))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantC, async client =>
    client.query(`update app.tenant_settings set time_zone = ''`))).rejects.toMatchObject({ code: '23514' })
  await expect(withTenant(tenantC, async client =>
    client.query(`update app.tenant_settings set time_zone = $1`, ['a'.repeat(65)]))).rejects.toMatchObject({ code: '23514' })

  const kept = await withTenant(tenantC, async (client) => {
    await client.query('update app.tenant_settings set airport_wait_minutes = 1440, elsewhere_wait_minutes = 1')
    return client.query('select airport_wait_minutes, elsewhere_wait_minutes, time_zone from app.tenant_settings')
  })

  expect(kept.rows).toEqual([{
    airport_wait_minutes: 1440,
    elsewhere_wait_minutes: 1,
    time_zone: 'Europe/Zagreb',
  }])
})
