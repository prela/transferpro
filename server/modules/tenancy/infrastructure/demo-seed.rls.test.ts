import type { DemoSeedAreaEnv } from './demo-seed-area'
import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { configureLogger } from '../../../core/index'
import { DemoSeedError, seedDemoTenant } from './demo-seed'

/**
 * The demo seed writes the operating area through the owner command.
 * Coordinates here are arbitrary and in bounds. They are not a real place.
 * A refusal has to leave the previous `demo` rows untouched.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')
configureLogger('info')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })

const password = 'demo-seed-password'
const area: DemoSeedAreaEnv = {
  DEMO_SEED_AREA_NAME: 'Područje Primjer',
  DEMO_SEED_AREA_LAT: '12.5',
  DEMO_SEED_AREA_LNG: '-7.25',
  DEMO_SEED_AREA_RADIUS_KM: '15',
  DEMO_SEED_AREA_COUNTRY: 'AX',
}

async function seed(areaEnv: DemoSeedAreaEnv): Promise<void> {
  await seedDemoTenant({
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
    area: areaEnv,
  })
}

afterAll(async () => {
  await ownerPool.end()
})

it('sets one active area, keeps it across a reseed, and refuses before a write', async () => {
  await seed(area)
  const first = await readActive()
  expect(first).toMatchObject({
    name: 'Područje Primjer',
    center_lat: '12.50000',
    center_lng: '-7.25000',
    radius_m: 15000,
    country_code: 'AX',
  })
  const areaAudits = await ownerPool.query<{ data: unknown }>(
    `select data from app.audit_entry
     where tenant_id::text = $1 and action = 'settings.operating_area_set'
     order by occurred_at desc
     limit 1`,
    [first.tenant_id],
  )
  expect(areaAudits.rows).toEqual([{ data: { fields: ['name', 'center', 'radiusM'] } }])
  expect(JSON.stringify(areaAudits.rows)).not.toContain('12.5')
  expect(JSON.stringify(areaAudits.rows)).not.toContain('Područje')
  const areaAuditCount = await countAudits(first.tenant_id, 'settings.operating_area_set')
  const countryAuditCount = await countAudits(first.tenant_id, 'settings.country_changed')

  await seed(area)
  const second = await readActive()
  expect(second).toEqual(first)
  expect(await countAudits(first.tenant_id, 'settings.operating_area_set')).toBe(areaAuditCount)
  expect(await countAudits(first.tenant_id, 'settings.country_changed')).toBe(countryAuditCount)

  await seed({ DEMO_SEED_AREA_COUNTRY: 'QA' })
  const countryOnly = await readActive()
  expect(countryOnly).toEqual({ ...first, country_code: 'QA' })
  expect(await countAudits(first.tenant_id, 'settings.operating_area_set')).toBe(areaAuditCount)
  expect(await countAudits(first.tenant_id, 'settings.country_changed')).toBe(countryAuditCount + 1)
  const countryAudit = await ownerPool.query(
    `select data from app.audit_entry
     where tenant_id::text = $1 and action = 'settings.country_changed'
     order by occurred_at desc
     limit 1`,
    [first.tenant_id],
  )
  expect(countryAudit.rows).toEqual([{ data: { from: 'AX', to: 'QA' } }])

  const secret = '99.99111'
  await expect(seed({ DEMO_SEED_AREA_NAME: 'Područje Primjer' })).rejects.toThrow(DemoSeedError)
  await expect(seed({ DEMO_SEED_AREA_NAME: 'Područje Primjer' })).rejects.toThrow(
    'Set DEMO_SEED_AREA_NAME, DEMO_SEED_AREA_LAT, DEMO_SEED_AREA_LNG, and DEMO_SEED_AREA_RADIUS_KM together. Set: DEMO_SEED_AREA_NAME.',
  )
  await expect(seed({ ...area, DEMO_SEED_AREA_LAT: secret })).rejects.toThrow('The operating area is out of bounds.')
  try {
    await seed({ ...area, DEMO_SEED_AREA_LAT: secret })
  }
  catch (error) {
    expect((error as Error).message).not.toContain(secret)
  }
  expect(await readActive()).toEqual(countryOnly)

  await seed({})
  const cleared = await ownerPool.query<{ active: number }>(
    `select count(*)::int as active
     from app.operating_area
     where tenant_id::text = $1 and archived_at is null`,
    [first.tenant_id],
  )
  expect(cleared.rows[0]?.active).toBe(0)
}, 120_000)

/**
 * The picture test guards the cases. This one guards the insert: a column
 * the seed stops writing would leave Home, the day list, or the phone empty.
 */
it('stores the handoff, the seats, the crowded ride, the flights, and tomorrow', async () => {
  await seed({})
  const tenant = await ownerPool.query<{ id: string }>(
    `select id::text as id from auth.organization where slug = 'demo'`,
  )
  const tenantId = tenant.rows[0]?.id
  if (tenantId === undefined)
    throw new Error('The demo tenant is missing.')

  const seats = await ownerPool.query<{ seat_count: number | null }>(
    `select seat_count from app.vehicles where tenant_id::text = $1 order by registration_plate`,
    [tenantId],
  )
  expect(seats.rows.map(row => row.seat_count)).toEqual([4, 4, 4, 4])

  const partner = await ownerPool.query(
    `select name, phone, email from app.partners where tenant_id::text = $1`,
    [tenantId],
  )
  expect(partner.rows).toEqual([{
    name: 'Prijevoznik Izmišljeni',
    phone: '555-0199',
    email: 'demo-partner@example.com',
  }])

  const rides = await ownerPool.query<{
    transfer_id: string
    guest_name: string
    state: string
    partner_confirmed: boolean
    passenger_count: number
    flight_number: string | null
    group_passenger_count: number | null
    price: string
    link: string | null
    seat_count: number | null
    must_accept: boolean | null
  }>(
    `select t.id::text as transfer_id, t.guest_name, r.state, r.partner_confirmed,
            t.passenger_count, t.flight_number, t.group_passenger_count,
            t.price::text as price, t.link::text as link, v.seat_count, r.must_accept
     from app.rides as r
     join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
     left join app.vehicles as v on v.id = r.vehicle_id and v.tenant_id = r.tenant_id
     where r.tenant_id::text = $1`,
    [tenantId],
  )
  const byName = new Map(rides.rows.map(row => [row.guest_name, row]))
  expect(byName.get('Gost Partner Čeka')).toMatchObject({ state: 'handed_off', partner_confirmed: false })
  expect(byName.get('Gost Partner Potvrda')).toMatchObject({ state: 'handed_off', partner_confirmed: true })
  expect(byName.get('Gost Previše')).toMatchObject({ passenger_count: 6, seat_count: 4, state: 'assigned' })
  expect(byName.get('Gost Let Danas')?.flight_number).toBe('ZZ 1101')
  expect(byName.get('Gost Let Sutra')?.flight_number).toBe('ZZ 1202')
  expect(byName.get('Gost Prihvat Sutra')).toMatchObject({ state: 'assigned', must_accept: true })
  expect(byName.get('Gost Slobodno')).toMatchObject({ state: 'unassigned', must_accept: null })
  const main = byName.get('Gost Skupina')
  const extra = byName.get('Gost Skupina Extra')
  expect(main).toMatchObject({ group_passenger_count: 6, link: null, passenger_count: 4 })
  expect(extra).toMatchObject({ group_passenger_count: null, price: '0.00', passenger_count: 2 })
  expect(extra?.link).toBe(main?.transfer_id)
}, 120_000)

async function countAudits(tenantId: string, action: string): Promise<number> {
  const selected = await ownerPool.query<{ n: number }>(
    `select count(*)::int as n from app.audit_entry
     where tenant_id::text = $1 and action = $2`,
    [tenantId, action],
  )
  return selected.rows[0]?.n ?? 0
}

async function readActive(): Promise<{
  tenant_id: string
  id: string
  name: string
  center_lat: string
  center_lng: string
  radius_m: number
  country_code: string | null
}> {
  const selected = await ownerPool.query(
    `select area.tenant_id::text, area.id::text, area.name,
            area.center_lat::text as center_lat, area.center_lng::text as center_lng,
            area.radius_m, settings.country_code
     from auth.organization as org
     join app.operating_area as area
       on area.tenant_id::text = org.id and area.archived_at is null
     join app.tenant_settings as settings
       on settings.tenant_id::text = org.id
     where org.slug = 'demo'`,
  )
  expect(selected.rows).toHaveLength(1)
  return selected.rows[0]
}
