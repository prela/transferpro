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
