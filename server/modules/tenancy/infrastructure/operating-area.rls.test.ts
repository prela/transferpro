import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { configureLogger } from '../../../core/index'
import { createTenant } from './create-tenant'
import { setOperatingArea } from './operating-area'
import { OPERATING_AREA_OUT_OF_BOUNDS, OperatingAreaError, parseOperatingAreaArgs } from './operating-area-args'

/**
 * The operating area is tenant data. The app role cannot see or write
 * another Tenant's row, the table refuses a value outside its bounds and a
 * second active area, and there is no DELETE. The owner command sets
 * tenant_id itself (ADR-0063).
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
const databaseUrl = required('DATABASE_URL')
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })

const tenantA = '586a0000-0000-4000-8000-00000000000a'
const tenantB = '586b0000-0000-4000-8000-00000000000b'
const password = 'operating-area-password'

async function pgError(run: () => Promise<unknown>): Promise<{ code: string, message: string }> {
  try {
    await run()
  }
  catch (error) {
    const coded = error as { code?: string, message?: string }
    return { code: coded.code ?? '', message: coded.message ?? '' }
  }
  throw new Error('expected the database to refuse')
}

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.operating_area where tenant_id::text in (
      select id from auth.organization where slug like 'oa-%'
    )`)
    await owner.query(`delete from app.operating_area where tenant_id in ($1, $2)`, [tenantA, tenantB])
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'oa-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id in ($1, $2)`, [tenantA, tenantB])
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (
      select id from auth."user" where email like 'oa-%@example.test'
    )`)
    await auth.query(`delete from auth.account where user_id in (
      select id from auth."user" where email like 'oa-%@example.test'
    )`)
    await auth.query(`delete from auth.member where organization_id in (
      select id from auth.organization where slug like 'oa-%'
    )`)
    await auth.query(`delete from auth."user" where email like 'oa-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'oa-%'`)
    await auth.query('commit')
  }
  catch (error) {
    await owner.query('rollback')
    await auth.query('rollback')
    throw error
  }
  finally {
    owner.release()
    auth.release()
  }
})

afterAll(async () => {
  await authPool.end()
  await ownerPool.end()
  await appPool.end()
})

it('forces row-level security and grants read and write, not delete', async () => {
  const forced = await ownerPool.query<{ relforcerowsecurity: boolean, relrowsecurity: boolean }>(
    `select relforcerowsecurity, relrowsecurity
     from pg_class
     where oid = 'app.operating_area'::regclass`,
  )
  expect(forced.rows[0]).toEqual({ relforcerowsecurity: true, relrowsecurity: true })
  const grants = await ownerPool.query<{ privilege_type: string }>(
    `select privilege_type
     from information_schema.role_table_grants
     where table_schema = 'app' and table_name = 'operating_area' and grantee = 'transferpro_app'
     order by privilege_type`,
  )
  expect(grants.rows.map(row => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE'])
})

async function withTenant<T>(tenantId: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
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

it('hides another Tenant\'s area and refuses a cross-tenant write, a bad bound, a second active area, and a delete', async () => {
  try {
    await withTenant(tenantA, async (client) => {
      await client.query(
        `insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
         values ($1, 'Područje Primjer', 12.50000, -7.25000, 15000)`,
        [tenantA],
      )
      await client.query(
        `insert into app.tenant_settings (tenant_id, default_locale, time_zone)
         values ($1, 'hr', 'Europe/Zagreb')`,
        [tenantA],
      )
      await client.query(`update app.tenant_settings set country_code = 'HR' where tenant_id = $1`, [tenantA])
      await client.query(`update app.tenant_settings set country_code = null where tenant_id = $1`, [tenantA])
    })

    const bounds = [
      [`insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
        values ($1, 'Područje Primjer', 91, 0, 15000)`, [tenantA]],
      [`insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
        values ($1, 'Područje Primjer', 0, 181, 15000)`, [tenantA]],
      [`insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
        values ($1, 'Područje Primjer', 0, 0, 999)`, [tenantA]],
      [`insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
        values ($1, 'Područje Primjer', 0, 0, 50001)`, [tenantA]],
      [`insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
        values ($1, '  ', 0, 0, 15000)`, [tenantA]],
      [`insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
        values ($1, ' Područje Primjer', 0, 0, 15000)`, [tenantA]],
      [`insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
        values ($1, $2, 0, 0, 15000)`, [tenantA, 'N'.repeat(201)]],
    ] as const
    for (const [statement, params] of bounds) {
      const refused = await pgError(() => withTenant(tenantA, client => client.query(statement, [...params])))
      expect(refused.code).toBe('23514')
    }
    for (const code of ['uk', 'zz', 'hr']) {
      const refused = await pgError(() => withTenant(tenantA, client => client.query(
        `update app.tenant_settings set country_code = $2 where tenant_id = $1`,
        [tenantA, code],
      )))
      expect(refused.code).toBe('23514')
    }

    const duplicate = await pgError(() => withTenant(tenantA, client => client.query(
      `insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
       values ($1, 'Područje Drugo', 1, 1, 1000)`,
      [tenantA],
    )))
    expect(duplicate.code).toBe('23505')

    await withTenant(tenantA, async (client) => {
      await client.query(
        `update app.operating_area set archived_at = now() where tenant_id = $1 and archived_at is null`,
        [tenantA],
      )
      await client.query(
        `insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
         values ($1, 'Područje Drugo', 1.00000, 1.00000, 1000)`,
        [tenantA],
      )
      const active = await client.query(
        `select count(*)::int as active from app.operating_area where tenant_id = $1 and archived_at is null`,
        [tenantA],
      )
      expect(active.rows[0]?.active).toBe(1)
    })

    const deleted = await pgError(() => withTenant(tenantA, client =>
      client.query(`delete from app.operating_area where tenant_id = $1`, [tenantA])))
    expect(deleted.code).toBe('42501')

    const seenByB = await withTenant(tenantB, async (client) => {
      const selected = await client.query(`select id from app.operating_area`)
      const updated = await client.query(`update app.operating_area set name = 'Područje Drugo'`)
      return { rows: selected.rows, updated: updated.rowCount }
    })
    expect(seenByB.rows).toEqual([])
    expect(seenByB.updated).toBe(0)

    const inserted = await pgError(() => withTenant(tenantB, client => client.query(
      `insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
       values ($1, 'Područje Primjer', 12.50000, -7.25000, 15000)`,
      [tenantA],
    )))
    expect(inserted.code).toBe('42501')

    await withTenant(tenantB, client => client.query(
      `insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
       values ($1, 'Područje Primjer', 3.00000, 4.00000, 2000)`,
      [tenantB],
    ))
    const moved = await pgError(() => withTenant(tenantB, client => client.query(
      `update app.operating_area set tenant_id = $1`,
      [tenantA],
    )))
    expect(moved.code).toBe('42501')
  }
  finally {
    await ownerPool.query(`delete from app.operating_area where tenant_id in ($1, $2)`, [tenantA, tenantB])
    await ownerPool.query(`delete from app.tenant_settings where tenant_id in ($1, $2)`, [tenantA, tenantB])
  }
})

it('inserts, updates in place, skips the same values, archives, and refuses an unknown slug', async () => {
  const created = await createTenant({
    name: 'Tenant Primjer',
    slug: 'oa-primjer',
    adminEmail: 'oa-primjer-admin@example.test',
    adminName: 'Admin Primjer',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const other = await createTenant({
    name: 'Tenant Drugi',
    slug: 'oa-drugi',
    adminEmail: 'oa-drugi-admin@example.test',
    adminName: 'Admin Drugi',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })

  const first = parseOperatingAreaArgs([
    '--slug',
    'oa-primjer',
    '--name',
    'Područje Primjer',
    '--lat',
    '12.5',
    '--lng',
    '-7.25',
    '--radius-km',
    '15',
    '--country',
    'HR',
  ])
  expect(await setOperatingArea({ migrateDatabaseUrl, command: first })).toBe('changed')
  const stored = await ownerPool.query<{
    id: string
    name: string
    center_lat: number
    center_lng: number
    radius_m: number
    country_code: string
  }>(
    `select area.id::text, area.name, area.center_lat::float8 as center_lat,
            area.center_lng::float8 as center_lng, area.radius_m, settings.country_code
     from app.operating_area as area
     join app.tenant_settings as settings on settings.tenant_id = area.tenant_id
     where area.tenant_id = $1 and area.archived_at is null`,
    [created.tenantId],
  )
  expect(stored.rows).toEqual([{
    id: stored.rows[0]?.id,
    name: 'Područje Primjer',
    center_lat: 12.5,
    center_lng: -7.25,
    radius_m: 15000,
    country_code: 'HR',
  }])
  const audits = await ownerPool.query<{ action: string, actor_user_id: string, subject_user_id: string | null, data: unknown }>(
    `select action, actor_user_id, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action in (
       'settings.operating_area_set',
       'settings.operating_area_archived',
       'settings.country_changed'
     )`,
    [created.tenantId],
  )
  expect(audits.rows).toEqual(expect.arrayContaining([
    {
      action: 'settings.operating_area_set',
      actor_user_id: 'transferpro_owner',
      subject_user_id: null,
      data: { fields: ['name', 'center', 'radiusM'] },
    },
    {
      action: 'settings.country_changed',
      actor_user_id: 'transferpro_owner',
      subject_user_id: null,
      data: { from: null, to: 'HR' },
    },
  ]))
  expect(JSON.stringify(audits.rows)).not.toContain('Područje')
  expect(JSON.stringify(audits.rows)).not.toContain('12.5')

  const radiusOnly = parseOperatingAreaArgs([
    '--slug',
    'oa-primjer',
    '--name',
    'Područje Primjer',
    '--lat',
    '12.5',
    '--lng',
    '-7.25',
    '--radius-km',
    '20',
  ])
  expect(await setOperatingArea({ migrateDatabaseUrl, command: radiusOnly })).toBe('changed')
  const updated = await ownerPool.query<{ id: string, radius_m: number }>(
    `select id::text, radius_m from app.operating_area where tenant_id = $1 and archived_at is null`,
    [created.tenantId],
  )
  expect(updated.rows).toEqual([{ id: stored.rows[0]?.id, radius_m: 20000 }])
  const radiusAudit = await ownerPool.query(
    `select data from app.audit_entry
     where tenant_id = $1 and action = 'settings.operating_area_set'
     order by occurred_at`,
    [created.tenantId],
  )
  expect(radiusAudit.rows).toEqual([
    { data: { fields: ['name', 'center', 'radiusM'] } },
    { data: { fields: ['name', 'center', 'radiusM'] } },
  ])

  expect(await setOperatingArea({ migrateDatabaseUrl, command: radiusOnly })).toBe('unchanged')
  const stillTwo = await ownerPool.query(
    `select data from app.audit_entry
     where tenant_id = $1 and action = 'settings.operating_area_set'`,
    [created.tenantId],
  )
  expect(stillTwo.rows).toHaveLength(2)

  expect(await setOperatingArea({
    migrateDatabaseUrl,
    command: parseOperatingAreaArgs(['--slug', 'oa-primjer', '--archive']),
  })).toBe('changed')
  const archived = await ownerPool.query<{ active: number, archived: number }>(
    `select count(*) filter (where archived_at is null)::int as active,
            count(*) filter (where archived_at is not null)::int as archived
     from app.operating_area where tenant_id = $1`,
    [created.tenantId],
  )
  expect(archived.rows[0]).toEqual({ active: 0, archived: 1 })
  expect(await setOperatingArea({
    migrateDatabaseUrl,
    command: parseOperatingAreaArgs(['--slug', 'oa-primjer', '--archive']),
  })).toBe('unchanged')
  const archivedAudits = await ownerPool.query(
    `select id from app.audit_entry where tenant_id = $1 and action = 'settings.operating_area_archived'`,
    [created.tenantId],
  )
  expect(archivedAudits.rows).toHaveLength(1)

  expect(await setOperatingArea({
    migrateDatabaseUrl,
    command: parseOperatingAreaArgs([
      '--slug',
      'oa-primjer',
      '--name',
      'Područje Drugo',
      '--lat',
      '1',
      '--lng',
      '2',
      '--radius-km',
      '1',
    ]),
  })).toBe('changed')
  const again = await ownerPool.query<{ active: number }>(
    `select count(*)::int as active from app.operating_area where tenant_id = $1 and archived_at is null`,
    [created.tenantId],
  )
  expect(again.rows[0]?.active).toBe(1)

  expect(await setOperatingArea({
    migrateDatabaseUrl,
    command: parseOperatingAreaArgs(['--slug', 'oa-drugi', '--country', 'GB']),
  })).toBe('changed')
  const countryOnly = await ownerPool.query<{ country_code: string, areas: number }>(
    `select settings.country_code, count(area.id)::int as areas
     from app.tenant_settings as settings
     left join app.operating_area as area on area.tenant_id = settings.tenant_id
     where settings.tenant_id = $1
     group by settings.country_code`,
    [other.tenantId],
  )
  expect(countryOnly.rows).toEqual([{ country_code: 'GB', areas: 0 }])
  const countryAudit = await ownerPool.query(
    `select data from app.audit_entry where tenant_id = $1 and action = 'settings.country_changed'`,
    [other.tenantId],
  )
  expect(countryAudit.rows).toEqual([{ data: { from: null, to: 'GB' } }])

  const untouched = await ownerPool.query(
    `select radius_m from app.operating_area where tenant_id = $1 and archived_at is null`,
    [created.tenantId],
  )
  expect(untouched.rows).toEqual([{ radius_m: 1000 }])

  const missing = 'oa-missing-token'
  await expect(setOperatingArea({
    migrateDatabaseUrl,
    command: { mode: 'archive', slug: missing },
  })).rejects.toThrow('No tenant matches that slug.')
  try {
    await setOperatingArea({ migrateDatabaseUrl, command: { mode: 'archive', slug: missing } })
  }
  catch (error) {
    expect((error as Error).message).not.toContain(missing)
  }

  const secret = '99.00000'
  await expect(setOperatingArea({
    migrateDatabaseUrl,
    command: {
      mode: 'area',
      slug: 'oa-primjer',
      name: 'Područje Primjer',
      latitude: secret,
      longitude: '0.00000',
      radiusM: 1000,
    },
  })).rejects.toThrow(OPERATING_AREA_OUT_OF_BOUNDS)
  try {
    await setOperatingArea({
      migrateDatabaseUrl,
      command: {
        mode: 'area',
        slug: 'oa-primjer',
        name: 'Područje Primjer',
        latitude: secret,
        longitude: '0.00000',
        radiusM: 1000,
      },
    })
  }
  catch (error) {
    expect(error).toBeInstanceOf(OperatingAreaError)
    expect((error as Error).message).not.toContain(secret)
  }

  await expect(setOperatingArea({
    migrateDatabaseUrl: databaseUrl,
    command: { mode: 'archive', slug: 'oa-primjer' },
  })).rejects.toThrow('It must be transferpro_owner.')
})
