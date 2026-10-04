import type { TenantRole } from '../../../../shared'
import type { AuthHandle } from './auth'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, readAuditLog, readTenantSettings, updateTenantSettings } from '..'
import { createAuth } from './auth'
import { createTenant } from './create-tenant'

/**
 * No-show waits and the Tenant time zone. Calls go through the module's
 * session functions, as the routes do. Entries are counted as the owner,
 * so the count does not depend on the policy under test. Each test has its
 * own Tenant, because entries cannot be deleted between runs.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const password = 'tenant-settings-password'

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const handle: AuthHandle = createAuth({
  AUTH_DATABASE_URL: authDatabaseUrl,
  BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
  BETTER_AUTH_URL: required('BETTER_AUTH_URL'),
})

const initial = {
  airportWaitMinutes: 90,
  elsewhereWaitMinutes: 25,
  timeZone: 'Europe/Zagreb',
}

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'ts-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'ts-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'ts-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'ts-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'ts-%'`)
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
  await closeTenantRuntime()
  await handle.close()
  await authPool.end()
  await ownerPool.end()
})

async function tenant(slug: string, adminName: string) {
  return createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName,
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
}

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<string> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, name, email],
  )
  await authPool.query(
    `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), userId, await hashPassword(password)],
  )
  await authPool.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), tenantId, userId, role],
  )
  return userId
}

async function signIn(email: string): Promise<Headers> {
  const signedIn = await handle.auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  return new Headers({ cookie: signedIn.headers.getSetCookie().map(part => part.split(';')[0]).join('; ') })
}

async function entryCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query('select count(*)::int as count from app.audit_entry where tenant_id = $1', [tenantId])
  return result.rows[0].count
}

it('a new tenant starts with a 90-minute airport wait, a 25-minute wait elsewhere, and Europe/Zagreb', async () => {
  const created = await tenant('ts-defaults', 'Nika Admin')
  const admin = await signIn('ts-defaults-admin@example.test')

  expect(await readTenantSettings(admin)).toEqual(initial)
  expect(await entryCount(created.tenantId)).toBe(0)
})

it('each change of a wait or the time zone appends exactly one entry naming the admin who made it', async () => {
  const created = await tenant('ts-change', 'Ana Admin')
  const actingAdmin = await addMember(created.tenantId, 'ts-change-acting@example.test', 'Ben Admin', 'admin')
  const admin = await signIn('ts-change-acting@example.test')

  // The form sends every field. Only the one that differs is a change.
  await updateTenantSettings(admin, { airportWaitMinutes: 100, elsewhereWaitMinutes: 25, timeZone: 'Europe/Zagreb' })
  const airport = await readAuditLog(admin)
  expect(airport.entries).toHaveLength(1)
  expect(airport.entries[0]).toMatchObject({
    actorUserId: actingAdmin,
    actorName: 'Ben Admin',
    action: 'settings.airport_wait_changed',
    subjectUserId: null,
    subjectName: null,
    data: { from: 90, to: 100 },
  })
  expect(await entryCount(created.tenantId)).toBe(1)

  await updateTenantSettings(admin, { elsewhereWaitMinutes: 40 })
  await updateTenantSettings(admin, { timeZone: 'Europe/Berlin' })
  const { entries } = await readAuditLog(admin)
  expect(entries).toMatchObject([
    { actorUserId: actingAdmin, action: 'settings.time_zone_changed', subjectUserId: null, data: { from: 'Europe/Zagreb', to: 'Europe/Berlin' } },
    { actorUserId: actingAdmin, action: 'settings.elsewhere_wait_changed', subjectUserId: null, data: { from: 25, to: 40 } },
    { actorUserId: actingAdmin, action: 'settings.airport_wait_changed', subjectUserId: null, data: { from: 90, to: 100 } },
  ])
  expect(entries).toHaveLength(3)
  expect(await entryCount(created.tenantId)).toBe(3)
  expect(await readTenantSettings(admin)).toEqual({
    airportWaitMinutes: 100,
    elsewhereWaitMinutes: 40,
    timeZone: 'Europe/Berlin',
  })
  expect(JSON.stringify(entries)).not.toContain('@example.test')
})

it('one request that changes two fields appends one entry for each and leaves the other field', async () => {
  const created = await tenant('ts-two', 'Tea Admin')
  const admin = await signIn('ts-two-admin@example.test')

  await updateTenantSettings(admin, { airportWaitMinutes: 110, timeZone: 'Europe/Berlin' })

  const { entries } = await readAuditLog(admin)
  // Both rows share the transaction's timestamp, so id, not append order, sorts them.
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'settings.time_zone_changed', subjectUserId: null, data: { from: 'Europe/Zagreb', to: 'Europe/Berlin' } }),
    expect.objectContaining({ action: 'settings.airport_wait_changed', subjectUserId: null, data: { from: 90, to: 110 } }),
  ]))
  expect(entries).toHaveLength(2)
  expect(await entryCount(created.tenantId)).toBe(2)
  expect(await readTenantSettings(admin)).toEqual({
    airportWaitMinutes: 110,
    elsewhereWaitMinutes: 25,
    timeZone: 'Europe/Berlin',
  })
})

it('a no-op or an invalid change appends nothing and leaves the row as it was', async () => {
  const created = await tenant('ts-noop', 'Neda Admin')
  const admin = await signIn('ts-noop-admin@example.test')

  await updateTenantSettings(admin, {})
  await updateTenantSettings(admin, initial)
  await expect(updateTenantSettings(admin, { airportWaitMinutes: 0 })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateTenantSettings(admin, { elsewhereWaitMinutes: 1441 })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateTenantSettings(admin, { airportWaitMinutes: 25.5 })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateTenantSettings(admin, { airportWaitMinutes: '90' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateTenantSettings(admin, { timeZone: 'Not/AZone' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateTenantSettings(admin, { timeZone: 'europe/zagreb' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateTenantSettings(admin, { airportWaitMinutes: 90, email: 'neda@example.test' })).rejects.toMatchObject({ statusCode: 400 })

  expect(await readTenantSettings(admin)).toEqual(initial)
  expect(await entryCount(created.tenantId)).toBe(0)
})

it('a dispatcher or a driver can read the settings and cannot change them', async () => {
  const created = await tenant('ts-roles', 'Roko Admin')
  await addMember(created.tenantId, 'ts-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'ts-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('ts-roles-admin@example.test')
  const dispatcher = await signIn('ts-roles-dispatcher@example.test')
  const driver = await signIn('ts-roles-driver@example.test')

  await updateTenantSettings(admin, { airportWaitMinutes: 80 })
  const changed = { airportWaitMinutes: 80, elsewhereWaitMinutes: 25, timeZone: 'Europe/Zagreb' }
  expect(await readTenantSettings(dispatcher)).toEqual(changed)
  expect(await readTenantSettings(driver)).toEqual(changed)

  await expect(updateTenantSettings(dispatcher, { airportWaitMinutes: 81 })).rejects.toMatchObject({ statusCode: 403 })
  await expect(updateTenantSettings(driver, { timeZone: 'Europe/Berlin' })).rejects.toMatchObject({ statusCode: 403 })
  await expect(updateTenantSettings(dispatcher, { elsewhereWaitMinutes: 10 })).rejects.toMatchObject({ statusCode: 403 })

  expect(await readTenantSettings(admin)).toEqual(changed)
  expect(await entryCount(created.tenantId)).toBe(1)
})

it('another tenant cannot read or change these settings', async () => {
  const created = await tenant('ts-isolated', 'Iva Admin')
  const other = await tenant('ts-isolated-other', 'Olga Admin')
  const admin = await signIn('ts-isolated-admin@example.test')
  const otherAdmin = await signIn('ts-isolated-other-admin@example.test')

  await updateTenantSettings(admin, { airportWaitMinutes: 120, elsewhereWaitMinutes: 30 })
  expect(await readTenantSettings(otherAdmin)).toEqual(initial)

  await updateTenantSettings(otherAdmin, { airportWaitMinutes: 40 })
  expect(await readTenantSettings(admin)).toEqual({
    airportWaitMinutes: 120,
    elsewhereWaitMinutes: 30,
    timeZone: 'Europe/Zagreb',
  })
  expect(await readTenantSettings(otherAdmin)).toEqual({
    airportWaitMinutes: 40,
    elsewhereWaitMinutes: 25,
    timeZone: 'Europe/Zagreb',
  })
  expect(await entryCount(created.tenantId)).toBe(2)
  expect(await entryCount(other.tenantId)).toBe(1)

  const own = await readAuditLog(admin)
  expect(own.entries.every(entry => entry.actorUserId === created.adminUserId)).toBe(true)
  expect(JSON.stringify(own.entries)).not.toContain(other.adminUserId)
})
