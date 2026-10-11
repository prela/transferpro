import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getDrivers from './drivers.get'
import postDriver from './drivers.post'
import patchDriver from './drivers/[id].patch'

/**
 * GET, POST, and PATCH /api/drivers, through the route handlers.
 * An invalid body is answered before a session exists. The role and member
 * cases use a real sign-in, the same way the screen will call these routes.
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
const password = 'drivers-http-password'
const phone = '+385911112222'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/drivers', (event) => {
  const pathOnly = event.path.split('?')[0] ?? '/'
  const id = pathOnly === '/' ? '' : decodeURIComponent(pathOnly.slice(1))
  if (id === '') {
    if (event.method === 'POST')
      return postDriver(event)
    return getDrivers(event)
  }
  event.context.params = { id }
  return patchDriver(event)
})
const callDrivers = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'hdr-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hdr-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hdr-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hdr-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hdr-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hdr-%'`)
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
  const response = await handleAuthRequest(new Request(new URL('/api/auth/sign-in/email', authUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
  if (!response.ok)
    throw new Error(`sign-in status ${response.status}`)
  return new Headers({ cookie: response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ') })
}

function call(method: string, path: string, session?: Headers, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return callDrivers(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function driverBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Marko Marić',
    kind: 'own',
    phone,
    drivingLicenceExpiresOn: '2027-06-01',
    transportLicenceExpiresOn: '2028-01-31',
    ...overrides,
  }
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'driver.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

it('post answers 400 for a bad body and does not echo the phone, and no session is 401', async () => {
  expect((await call('POST', '/api/drivers', undefined, driverBody({ name: '   ' }))).status).toBe(400)
  expect((await call('POST', '/api/drivers', undefined, driverBody({ kind: 'partner' }))).status).toBe(400)
  expect((await call('POST', '/api/drivers', undefined, driverBody({ drivingLicenceExpiresOn: '2026-02-31' }))).status).toBe(400)
  expect((await call('POST', '/api/drivers', undefined, driverBody({ mustAccept: true }))).status).toBe(400)
  const unknown = await call('POST', '/api/drivers', undefined, driverBody({ notes: 'call after 18' }))
  expect(unknown.status).toBe(400)
  const unknownText = await unknown.text()
  expect(unknownText).not.toContain(phone)
  const malformed = await call('POST', '/api/drivers', undefined, driverBody({ email: 'not-an-email' }))
  expect(malformed.status).toBe(400)
  expect(await malformed.text()).not.toContain('not-an-email')
  expect((await call('PATCH', '/api/drivers/not-a-uuid', undefined, { name: 'Marko' })).status).toBe(400)
  expect((await call('GET', '/api/drivers')).status).toBe(401)
  expect((await call('POST', '/api/drivers', undefined, driverBody())).status).toBe(401)
  expect((await call('PATCH', '/api/drivers/9e4b3f6d-5555-4555-8555-555555555555', undefined, { kind: 'external' })).status).toBe(401)
  expect((await call('GET', '/api/drivers?includeArchived=true')).status).toBe(401)
  expect((await call('GET', '/api/drivers?includeArchived=false')).status).toBe(401)
  expect((await call('GET', '/api/drivers?includeArchived=1')).status).toBe(400)
  expect((await call('GET', '/api/drivers?includeArchived=')).status).toBe(400)
  expect((await call('GET', '/api/drivers?includeArchived=null')).status).toBe(400)
  expect((await call('GET', '/api/drivers?includeArchived=True')).status).toBe(400)
})

it('a dispatcher and an admin can add, correct, and list a Driver, and a driver is refused', async () => {
  const created = await tenant('hdr-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hdr-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hdr-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hdr-roles-admin@example.test')
  const dispatcher = await signIn('hdr-roles-dispatcher@example.test')
  const driver = await signIn('hdr-roles-driver@example.test')

  const refused = await call('POST', '/api/drivers', driver, driverBody({ name: 'Hidden' }))
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(phone)
  expect((await call('GET', '/api/drivers', driver)).status).toBe(403)

  const added = await call('POST', '/api/drivers', dispatcher, driverBody({ name: '  Marko Marić  ', phone: `  ${phone}  ` }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row).toEqual({
    id: expect.any(String),
    name: 'Marko Marić',
    kind: 'own',
    phone,
    drivingLicenceExpiresOn: '2027-06-01',
    transportLicenceExpiresOn: '2028-01-31',
    memberUserId: null,
    email: null,
    mustAccept: false,
  })

  const listed = await call('GET', '/api/drivers', admin)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({ drivers: [row] })
  expect((await call('GET', '/api/drivers?includeArchived=true', admin)).status).toBe(200)
  expect((await call('GET', '/api/drivers?includeArchived=false', admin)).status).toBe(200)

  const same = await call('PATCH', `/api/drivers/${row.id}`, dispatcher, { phone })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(row)

  const blocked = await call('PATCH', `/api/drivers/${row.id}`, dispatcher, { name: 'Nope', mustAccept: true })
  expect(blocked.status).toBe(403)

  const corrected = await call('PATCH', `/api/drivers/${row.id}`, admin, {
    name: 'Mara Marić',
    kind: 'external',
    phone: '+385911110000',
    drivingLicenceExpiresOn: '2029-03-03',
    mustAccept: true,
  })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({
    id: row.id,
    name: 'Mara Marić',
    kind: 'external',
    phone: '+385911110000',
    drivingLicenceExpiresOn: '2029-03-03',
    mustAccept: true,
    memberUserId: null,
    email: null,
  })

  expect((await call('PATCH', `/api/drivers/${row.id}`, driver, { name: 'Nope' })).status).toBe(403)
  const still = await call('GET', '/api/drivers', dispatcher)
  expect(await still.json()).toEqual({
    drivers: [expect.objectContaining({ id: row.id, name: 'Mara Marić', mustAccept: true })],
  })

  const missing = '9e4b3f6d-5555-4555-8555-555555555555'
  expect((await call('PATCH', `/api/drivers/${missing}`, admin, { kind: 'own' })).status).toBe(404)

  const rows = await auditRows(created.tenantId)
  expect(rows.every(entry => entry.subject_user_id === null)).toBe(true)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(phone)
  expect(text).not.toContain('+385911110000')
  expect(text).not.toContain('2027-06-01')
  expect(text).not.toContain('2029-03-03')
  expect(text).not.toContain('Marko')
  expect(text).not.toContain('Mara')
  expect(rows.map(entry => entry.action)).toContain('driver.created')
  expect(rows.filter(entry => entry.action === 'driver.field_changed').map(entry => entry.data)).toEqual(expect.arrayContaining([
    { driverId: row.id, field: 'name' },
    { driverId: row.id, field: 'kind' },
    { driverId: row.id, field: 'phone' },
    { driverId: row.id, field: 'drivingLicenceExpiresOn' },
    { driverId: row.id, field: 'mustAccept' },
  ]))
})

it('links a driver member, refuses a non-driver and a second Driver, and another Tenant cannot use the link', async () => {
  const first = await tenant('hdr-link-a', 'Ana Admin')
  const second = await tenant('hdr-link-b', 'Boris Admin')
  const driverMember = await addMember(first.tenantId, 'hdr-link-a-driver@example.test', 'Ivo Driver', 'driver')
  const officeMember = await addMember(first.tenantId, 'hdr-link-a-disp@example.test', 'Iva Office', 'dispatcher')
  const otherDriver = await addMember(second.tenantId, 'hdr-link-b-driver@example.test', 'Boro Driver', 'driver')
  const adminA = await signIn('hdr-link-a-admin@example.test')
  const adminB = await signIn('hdr-link-b-admin@example.test')

  expect((await call('POST', '/api/drivers', adminA, driverBody({ memberUserId: officeMember }))).status).toBe(400)
  expect((await call('POST', '/api/drivers', adminA, driverBody({ memberUserId: otherDriver }))).status).toBe(400)
  expect(await (await call('GET', '/api/drivers', adminA)).json()).toEqual({ drivers: [] })

  const added = await call('POST', '/api/drivers', adminA, driverBody({ memberUserId: driverMember }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row.memberUserId).toBe(driverMember)

  const unlinked = await call('POST', '/api/drivers', adminA, driverBody({ name: 'Bez računa' }))
  expect(unlinked.status).toBe(200)
  expect((await unlinked.json()).memberUserId).toBeNull()

  expect((await call('POST', '/api/drivers', adminA, driverBody({
    name: 'Drugi',
    memberUserId: driverMember,
  }))).status).toBe(400)

  expect(await (await call('GET', '/api/drivers', adminB)).json()).toEqual({ drivers: [] })
  expect((await call('PATCH', `/api/drivers/${row.id}`, adminB, { name: 'Taken' })).status).toBe(404)

  const cleared = await call('PATCH', `/api/drivers/${row.id}`, adminA, { memberUserId: null })
  expect(cleared.status).toBe(200)
  expect((await cleared.json()).memberUserId).toBeNull()

  const rows = await auditRows(first.tenantId)
  expect(JSON.stringify(rows)).not.toContain(phone)
  expect(JSON.stringify(rows)).not.toContain(driverMember)
})

it('records an optional email, copies the sign-in email, and does not audit the address', async () => {
  const created = await tenant('hdr-email', 'Ema Admin')
  await addMember(created.tenantId, 'hdr-email-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverMember = await addMember(created.tenantId, 'hdr-email-driver@example.test', 'Drago Driver', 'driver')
  const signInEmail = 'hdr-email-driver@example.test'
  const officeEmail = 'office@example.test'
  const admin = await signIn('hdr-email-admin@example.test')
  const dispatcher = await signIn('hdr-email-dispatcher@example.test')
  const driver = await signIn(signInEmail)

  expect((await call('POST', '/api/drivers', driver, driverBody({ email: officeEmail }))).status).toBe(403)
  expect((await call('POST', '/api/drivers', admin, driverBody({ email: 'not-an-email' }))).status).toBe(400)
  expect(await (await call('GET', '/api/drivers', admin)).json()).toEqual({ drivers: [] })

  const added = await call('POST', '/api/drivers', dispatcher, driverBody({ email: `  ${officeEmail}  ` }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row.email).toBe(officeEmail)
  expect(await (await call('GET', '/api/drivers', admin)).json()).toEqual({ drivers: [row] })

  const cleared = await call('PATCH', `/api/drivers/${row.id}`, dispatcher, { email: null })
  expect(cleared.status).toBe(200)
  expect((await cleared.json()).email).toBeNull()

  const replaced = await call('PATCH', `/api/drivers/${row.id}`, admin, { email: 'next@example.test' })
  expect(replaced.status).toBe(200)
  expect((await replaced.json()).email).toBe('next@example.test')

  expect((await call('POST', '/api/drivers', admin, driverBody({
    name: 'S računom',
    memberUserId: driverMember,
    email: officeEmail,
  }))).status).toBe(400)

  const linked = await call('POST', '/api/drivers', admin, driverBody({
    name: 'S računom',
    memberUserId: driverMember,
  }))
  expect(linked.status).toBe(200)
  const linkedRow = await linked.json()
  expect(linkedRow.email).toBe(signInEmail)
  expect((await call('PATCH', `/api/drivers/${linkedRow.id}`, dispatcher, { email: 'other@example.test' })).status).toBe(400)
  expect((await call('PATCH', `/api/drivers/${linkedRow.id}`, driver, { email: null })).status).toBe(403)

  const unlinked = await call('PATCH', `/api/drivers/${linkedRow.id}`, admin, { memberUserId: null })
  expect(unlinked.status).toBe(200)
  expect(await unlinked.json()).toMatchObject({ memberUserId: null, email: signInEmail })

  const edited = await call('PATCH', `/api/drivers/${linkedRow.id}`, dispatcher, { email: 'kept@example.test' })
  expect(edited.status).toBe(200)
  expect((await edited.json()).email).toBe('kept@example.test')

  const rows = await auditRows(created.tenantId)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(officeEmail)
  expect(text).not.toContain(signInEmail)
  expect(text).not.toContain('next@example.test')
  expect(text).not.toContain('kept@example.test')
  expect(rows.filter(entry => entry.action === 'driver.field_changed').map(entry => entry.data)).toEqual(expect.arrayContaining([
    { driverId: row.id, field: 'email' },
    { driverId: linkedRow.id, field: 'memberUserId' },
    { driverId: linkedRow.id, field: 'email' },
  ]))
})
