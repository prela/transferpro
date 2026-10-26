import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createClient, createContactPerson, removeClientContactPerson, updateClient, updateContactPerson, writeClientNote } from '../modules/clients'
import { archiveDriver, createDriver, unarchiveDriver, updateDriver } from '../modules/drivers'
import { archiveLocation, createLocation, updateLocation } from '../modules/locations'
import { archivePartner, createPartner, restorePartner, updatePartner } from '../modules/partners'
import { setRosterDay } from '../modules/roster'
import { changeMemberRole, chooseActiveTenant, closeTenantRuntime, createTenant, handleAuthRequest, inviteMember, readSessionShell, removeTenantMember, revokePendingInvitation, switchActiveTenant, TenantAccessError, TenantChangedError, updateTenantSettings } from '../modules/tenancy'
import { acceptRide, acceptRideByPhone, addUnavailability, assignRide, cancelRide, changeRidePartner, changeUnavailability, changeVehicle, clearRide, correctTransfer, createTransfer, declineRide, handOffRide, markNoShow, markRideDone, reassignRide, recordRideLanding, removeUnavailability, takeBackRide } from '../modules/transfers'
import { archiveVehicle, createVehicle, updateVehicle } from '../modules/vehicles'
import postClient from './clients.post'

/**
 * The screen Tenant is compared with the session Tenant before a write.
 * One person belongs to two companies. After the session moves, a write
 * that still names the company the screen was opened for changes nothing.
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
const password = 'tenant-changed-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')
const id = '00000000-0000-4000-8000-0000000000aa'

const app = createApp()
app.use('/api/clients', event => postClient(event))
const callClients = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'tch-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'tch-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'tch-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'tch-%@example.test')`)
    await auth.query(`delete from auth.invitation where organization_id::text in (select id from auth.organization where slug like 'tch-%')`)
    await auth.query(`delete from auth."user" where email like 'tch-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'tch-%'`)
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

async function tenant(slug: string) {
  return createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName: 'Ana Changed',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
}

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<void> {
  const found = await authPool.query<{ id: string }>('select id from auth."user" where email = $1', [email])
  const userId = found.rows[0]?.id
  if (!userId)
    throw new Error('missing account')
  await authPool.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), tenantId, userId, role],
  )
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

function naming(session: Headers, tenantId: string): Headers {
  const headers = new Headers(session)
  headers.set('x-expected-tenant-id', tenantId)
  return headers
}

async function auditCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    'select count(*)::text as count from app.audit_entry where tenant_id = $1',
    [tenantId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function clientNames(): Promise<Array<{ name: string, tenant_id: string }>> {
  const result = await ownerPool.query<{ name: string, tenant_id: string }>(
    `select name, tenant_id::text as tenant_id from app.clients where name in ('Keep', 'Stolen') order by name`,
  )
  return result.rows
}

it('refuses a stale screen after the session moves, and every office write does too', async () => {
  const alpha = await tenant('tch-a')
  const beta = await tenant('tch-b')
  await addMember(beta.tenantId, 'tch-a-admin@example.test', 'Ana Changed', 'dispatcher')
  const headers = await signIn('tch-a-admin@example.test')
  const opened = await readSessionShell(headers).catch(error => error)
  if (opened instanceof TenantAccessError) {
    expect(opened.statusCode).toBe(409)
    await chooseActiveTenant(headers, alpha.tenantId)
  }
  else if (opened.tenantId !== alpha.tenantId) {
    await switchActiveTenant(headers, alpha.tenantId)
  }

  await createClient(headers, { name: 'Keep', kind: 'agency' })
  const before = await auditCount(alpha.tenantId) + await auditCount(beta.tenantId)
  await switchActiveTenant(headers, beta.tenantId)

  await expect(createClient(headers, {
    name: 'Stolen',
    kind: 'agency',
    expectedTenantId: alpha.tenantId,
  })).rejects.toMatchObject({ name: 'TenantChangedError', statusCode: 409, code: 'tenant_changed' })
  expect(await clientNames()).toEqual([{ name: 'Keep', tenant_id: alpha.tenantId }])
  expect(await auditCount(alpha.tenantId) + await auditCount(beta.tenantId)).toBe(before)

  const missing = new Headers(headers)
  missing.set('x-expected-tenant-id', '')
  await expect(createClient(missing, { name: 'Stolen', kind: 'agency' })).rejects.toBeInstanceOf(TenantChangedError)
  expect(await clientNames()).toEqual([{ name: 'Keep', tenant_id: alpha.tenantId }])

  const stale = naming(headers, alpha.tenantId)
  const refused = [
    () => updateClient(stale, id, {}),
    () => writeClientNote(stale, id, {}),
    () => createContactPerson(stale, id, {}),
    () => updateContactPerson(stale, id, id, {}),
    () => removeClientContactPerson(stale, id, id, {}),
    () => createPartner(stale, {}),
    () => updatePartner(stale, id, {}),
    () => archivePartner(stale, id, {}),
    () => restorePartner(stale, id, {}),
    () => createLocation(stale, {}),
    () => updateLocation(stale, id, {}),
    () => archiveLocation(stale, id, {}),
    () => createDriver(stale, {}),
    () => updateDriver(stale, id, {}),
    () => archiveDriver(stale, id, {}),
    () => unarchiveDriver(stale, id, {}),
    () => createVehicle(stale, {}),
    () => updateVehicle(stale, id, {}),
    () => archiveVehicle(stale, id, {}),
    () => setRosterDay(stale, {}),
    () => addUnavailability(stale, {}),
    () => changeUnavailability(stale, id, {}),
    () => removeUnavailability(stale, id, {}),
    () => createTransfer(stale, {}),
    () => correctTransfer(stale, id, {}),
    () => assignRide(stale, {}),
    () => changeVehicle(stale, {}),
    () => clearRide(stale, id, {}),
    () => reassignRide(stale, {}),
    () => handOffRide(stale, id, {}),
    () => changeRidePartner(stale, id, {}),
    () => takeBackRide(stale, id, {}),
    () => cancelRide(stale, id, {}),
    () => acceptRide(stale, id, {}),
    () => acceptRideByPhone(stale, id, {}),
    () => markRideDone(stale, id, {}),
    () => markNoShow(stale, id, {}),
    () => declineRide(stale, id, {}),
    () => recordRideLanding(stale, id, {}),
    () => updateTenantSettings(stale, {}),
    () => inviteMember(stale, {}, { deliver: async () => 'sent' }),
    () => removeTenantMember(stale, id, {}),
    () => changeMemberRole(stale, id, {}),
    () => revokePendingInvitation(stale, id, {}),
  ]
  for (const write of refused)
    await expect(write()).rejects.toMatchObject({ statusCode: 409, code: 'tenant_changed' })
  expect(await clientNames()).toEqual([{ name: 'Keep', tenant_id: alpha.tenantId }])
  expect(await auditCount(alpha.tenantId) + await auditCount(beta.tenantId)).toBe(before)

  const response = await callClients(new Request('http://localhost/api/clients', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cookie': headers.get('cookie') ?? '',
    },
    body: JSON.stringify({ name: 'Stolen', kind: 'agency', expectedTenantId: alpha.tenantId }),
  }))
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('tenant_changed')
  expect(await clientNames()).toEqual([{ name: 'Keep', tenant_id: alpha.tenantId }])
})
