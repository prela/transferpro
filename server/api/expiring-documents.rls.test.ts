import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone } from '../../shared'
import { listExpiringDocuments } from '../modules/expiring-documents'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import postDriver from './drivers.post'
import getExpiringDocuments from './expiring-documents.get'
import postVehicle from './vehicles.post'
import archiveVehicle from './vehicles/[id]/archive.post'

/**
 * GET /api/expiring-documents, through the route handler.
 * Rows are created with the Drivers and Vehicles routes, then read back.
 * A driver is not 403: they see only their own licences.
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
const password = 'expiring-http-password'
const phone = '+385900000111'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/expiring-documents', event => getExpiringDocuments(event))
app.use('/api/drivers', event => postDriver(event))
app.use('/api/vehicles', (event) => {
  const pathOnly = event.path.split('?')[0] ?? '/'
  const rest = pathOnly === '/' ? '' : decodeURIComponent(pathOnly.slice(1))
  if (rest === '')
    return postVehicle(event)
  const [id, action] = rest.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'archive')
    return archiveVehicle(event)
  throw new Error(`unexpected vehicle path ${rest}`)
})
const callApp = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'xpd-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'xpd-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'xpd-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'xpd-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'xpd-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'xpd-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'xpd-%'`)
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
  return callApp(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function driverBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Ana Horvat',
    kind: 'own',
    phone,
    drivingLicenceExpiresOn: '2000-01-15',
    transportLicenceExpiresOn: '2099-01-01',
    ...overrides,
  }
}

function vehicleBody(overrides: Record<string, unknown> = {}) {
  return {
    registrationPlate: 'ZG100AA',
    kind: 'fixed',
    registrationExpiresOn: '2000-03-03',
    technicalInspectionExpiresOn: '2099-01-01',
    insuranceExpiresOn: '2099-01-01',
    ...overrides,
  }
}

async function auditCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*)::text as count from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

it('no session is 401', async () => {
  expect((await call('GET', '/api/expiring-documents')).status).toBe(401)
})

it('uses the tenant calendar day, not the UTC day', async () => {
  await tenant('xpd-zone', 'Zora Admin')
  const admin = await signIn('xpd-zone-admin@example.test')
  const added = await call('POST', '/api/drivers', admin, driverBody({
    name: 'Zora Zorić',
    drivingLicenceExpiresOn: '2026-01-15',
    transportLicenceExpiresOn: '2026-02-15',
  }))
  expect(added.status).toBe(200)
  const row = await added.json()
  // 15 Jan 2026 23:30 UTC is 16 Jan in Europe/Zagreb. 15 Jan is then already
  // expired, and 15 Feb is day 30 of that calendar, so it is still included.
  const listed = await listExpiringDocuments(admin, new Date('2026-01-15T23:30:00.000Z'))
  expect(listed.documents).toEqual([
    {
      subject: 'driver',
      subjectId: row.id,
      subjectLabel: 'Zora Zorić',
      kind: 'driving_licence',
      expiresOn: '2026-01-15',
      status: 'expired',
    },
    {
      subject: 'driver',
      subjectId: row.id,
      subjectLabel: 'Zora Zorić',
      kind: 'transport_licence',
      expiresOn: '2026-02-15',
      status: 'expiring',
    },
  ])
  expect(JSON.stringify(listed)).not.toContain(phone)
})

it('an office sees the tenant list, a driver sees only their licences, and another tenant sees nothing', async () => {
  const soon = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 15)
  const created = await tenant('xpd-roles', 'Hana Admin')
  await tenant('xpd-other', 'Ivo Admin')
  await addMember(created.tenantId, 'xpd-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const anaMember = await addMember(created.tenantId, 'xpd-roles-ana@example.test', 'Ana Member', 'driver')
  const borisMember = await addMember(created.tenantId, 'xpd-roles-boris@example.test', 'Boris Member', 'driver')
  await addMember(created.tenantId, 'xpd-roles-none@example.test', 'Niko Member', 'driver')
  const admin = await signIn('xpd-roles-admin@example.test')
  const dispatcher = await signIn('xpd-roles-dispatcher@example.test')
  const ana = await signIn('xpd-roles-ana@example.test')
  const boris = await signIn('xpd-roles-boris@example.test')
  const unlinked = await signIn('xpd-roles-none@example.test')
  const adminB = await signIn('xpd-other-admin@example.test')

  const addedAna = await call('POST', '/api/drivers', admin, driverBody({
    name: 'Ana Horvat',
    drivingLicenceExpiresOn: '2000-01-15',
    transportLicenceExpiresOn: soon,
    memberUserId: anaMember,
  }))
  expect(addedAna.status).toBe(200)
  const anaRow = await addedAna.json()

  const addedBoris = await call('POST', '/api/drivers', dispatcher, driverBody({
    name: 'Boris Kovač',
    drivingLicenceExpiresOn: '2000-01-01',
    transportLicenceExpiresOn: '2099-01-01',
    memberUserId: borisMember,
  }))
  expect(addedBoris.status).toBe(200)
  const borisRow = await addedBoris.json()

  const addedLive = await call('POST', '/api/vehicles', admin, vehicleBody({
    registrationPlate: 'ZG100AA',
    registrationExpiresOn: '2000-03-03',
    insuranceExpiresOn: soon,
  }))
  expect(addedLive.status).toBe(200)
  const live = await addedLive.json()

  const addedArchived = await call('POST', '/api/vehicles', admin, vehicleBody({
    registrationPlate: 'ZG999ZZ',
    registrationExpiresOn: '2000-01-01',
    technicalInspectionExpiresOn: '2000-01-01',
    insuranceExpiresOn: '2000-01-01',
  }))
  expect(addedArchived.status).toBe(200)
  const archived = await addedArchived.json()
  expect((await call('POST', `/api/vehicles/${archived.id}/archive`, admin)).status).toBe(200)

  const office = [
    { subject: 'driver', subjectId: borisRow.id, subjectLabel: 'Boris Kovač', kind: 'driving_licence', expiresOn: '2000-01-01', status: 'expired' },
    { subject: 'driver', subjectId: anaRow.id, subjectLabel: 'Ana Horvat', kind: 'driving_licence', expiresOn: '2000-01-15', status: 'expired' },
    { subject: 'vehicle', subjectId: live.id, subjectLabel: 'ZG100AA', kind: 'vehicle_registration', expiresOn: '2000-03-03', status: 'expired' },
    { subject: 'driver', subjectId: anaRow.id, subjectLabel: 'Ana Horvat', kind: 'transport_licence', expiresOn: soon, status: 'expiring' },
    { subject: 'vehicle', subjectId: live.id, subjectLabel: 'ZG100AA', kind: 'insurance', expiresOn: soon, status: 'expiring' },
  ]

  const before = await auditCount(created.tenantId)
  const listed = await call('GET', '/api/expiring-documents', admin)
  expect(listed.status).toBe(200)
  const listedBody = await listed.json()
  expect(listedBody).toEqual({ documents: office })
  expect(JSON.stringify(listedBody)).not.toContain(phone)
  expect(JSON.stringify(listedBody)).not.toContain(archived.id)
  expect(JSON.stringify(listedBody)).not.toContain('2099-01-01')

  const asDispatcher = await call('GET', '/api/expiring-documents', dispatcher)
  expect(asDispatcher.status).toBe(200)
  expect(await asDispatcher.json()).toEqual({ documents: office })

  const asAna = await call('GET', '/api/expiring-documents', ana)
  expect(asAna.status).toBe(200)
  const anaBody = await asAna.json()
  expect(anaBody).toEqual({
    documents: [
      { subject: 'driver', subjectId: anaRow.id, subjectLabel: 'Ana Horvat', kind: 'driving_licence', expiresOn: '2000-01-15', status: 'expired' },
      { subject: 'driver', subjectId: anaRow.id, subjectLabel: 'Ana Horvat', kind: 'transport_licence', expiresOn: soon, status: 'expiring' },
    ],
  })
  expect(JSON.stringify(anaBody)).not.toContain(borisRow.id)
  expect(JSON.stringify(anaBody)).not.toContain('ZG100AA')
  expect(JSON.stringify(anaBody)).not.toContain(phone)

  const asBoris = await call('GET', '/api/expiring-documents', boris)
  expect(asBoris.status).toBe(200)
  expect(await asBoris.json()).toEqual({
    documents: [
      { subject: 'driver', subjectId: borisRow.id, subjectLabel: 'Boris Kovač', kind: 'driving_licence', expiresOn: '2000-01-01', status: 'expired' },
    ],
  })

  const asUnlinked = await call('GET', '/api/expiring-documents', unlinked)
  expect(asUnlinked.status).toBe(200)
  expect(await asUnlinked.json()).toEqual({ documents: [] })

  const asOther = await call('GET', '/api/expiring-documents', adminB)
  expect(asOther.status).toBe(200)
  expect(await asOther.json()).toEqual({ documents: [] })

  expect(await auditCount(created.tenantId)).toBe(before)
})
