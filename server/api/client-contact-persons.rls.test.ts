import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getClients from './clients.get'
import postClient from './clients.post'
import getContacts from './clients/[id]/contact-persons.get'
import postContact from './clients/[id]/contact-persons.post'
import patchContact from './clients/[id]/contact-persons/[contactPersonId].patch'
import removeContact from './clients/[id]/contact-persons/[contactPersonId]/remove.post'

/**
 * Contact persons through the route handlers (ADR-0049). An invalid body is
 * answered before a session exists. The role cases use a real sign-in.
 * The slug prefix is `hcp-` so cleanup does not touch the Client suite's `hcl-` firms.
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
const password = 'contacts-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')
const missingId = '9e4b3f6d-5555-4555-8555-555555555555'

const app = createApp()
// h3 mounts `/api/clients` as a prefix, so the file route's params are the rest of the path.
app.use('/api/clients', (event) => {
  const rest = event.path === '/' ? '' : decodeURIComponent(event.path.slice(1))
  const parts = rest.split('/').filter(part => part !== '')
  if (parts.length === 0) {
    if (event.method === 'POST')
      return postClient(event)
    return getClients(event)
  }
  const id = parts[0] ?? ''
  const branch = parts[1]
  const contactPersonId = parts[2] ?? ''
  const action = parts[3]
  if (branch === 'contact-persons' && parts.length === 2) {
    event.context.params = { id }
    if (event.method === 'POST')
      return postContact(event)
    return getContacts(event)
  }
  if (branch === 'contact-persons' && parts.length === 3) {
    event.context.params = { id, contactPersonId }
    return patchContact(event)
  }
  if (branch === 'contact-persons' && action === 'remove' && parts.length === 4) {
    event.context.params = { id, contactPersonId }
    return removeContact(event)
  }
  throw new Error(`unmapped ${event.method} ${event.path}`)
})
const callClients = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.client_contact_persons where tenant_id::text in (
      select id from auth.organization where slug like 'hcp-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hcp-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hcp-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hcp-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hcp-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hcp-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hcp-%'`)
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
  return callClients(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

interface ContactBody {
  id: string
  clientId: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
  version: number
  changedAt: string | null
  changedByName: string | null
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'contact_person.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

async function clientVersion(clientId: string): Promise<number> {
  const result = await ownerPool.query<{ version: number }>(
    'select version from app.clients where id = $1',
    [clientId],
  )
  const version = result.rows[0]?.version
  if (version === undefined)
    throw new Error('missing client')
  return version
}

async function contactStamp(contactPersonId: string) {
  const result = await ownerPool.query<{
    name: string
    role: string | null
    phone: string | null
    email: string | null
    version: number
    removed_at: Date | null
  }>(
    `select name, role, phone, email, version, removed_at
     from app.client_contact_persons where id = $1`,
    [contactPersonId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('missing contact person')
  return row
}

async function office(slug: string) {
  const created = await tenant(slug, 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, `${slug}-driver@example.test`, 'Drago Driver', 'driver')
  const admin = await signIn(`${slug}-admin@example.test`)
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const driver = await signIn(`${slug}-driver@example.test`)
  const added = await call('POST', '/api/clients', admin, { name: 'Hotel Jadran', kind: 'hotel' })
  expect(added.status).toBe(200)
  const client = await added.json() as { id: string, name: string, kind: string }
  return { created, dispatcherId, admin, dispatcher, driver, client }
}

it('answers 400 for a bad body or a bad id, and 401 when nobody is signed in', async () => {
  const path = `/api/clients/${missingId}/contact-persons`
  expect((await call('POST', path, undefined, { name: '   ', phone: '+385911110364' })).status).toBe(400)
  expect((await call('POST', path, undefined, { name: 'Ana Booking' })).status).toBe(400)
  expect((await call('POST', path, undefined, { name: 'Ana Booking', phone: '   ' })).status).toBe(400)
  expect((await call('POST', path, undefined, { name: 'Ana Booking', email: 'not-an-email' })).status).toBe(400)
  const unknown = await call('POST', path, undefined, { name: 'Ana Booking', phone: '+385911110364', note: 'booking@example.test' })
  expect(unknown.status).toBe(400)
  expect(await unknown.text()).not.toContain('booking@example.test')
  expect((await call('POST', '/api/clients/not-a-uuid/contact-persons', undefined, { name: 'Ana Booking', phone: '+385911110364' })).status).toBe(400)
  expect((await call('PATCH', `${path}/${missingId}`, undefined, { name: 'Ana Booking' })).status).toBe(400)
  expect((await call('PATCH', `${path}/not-a-uuid`, undefined, { name: 'Ana Booking', version: 0 })).status).toBe(400)
  expect((await call('POST', `${path}/${missingId}/remove`, undefined, { version: 0, name: 'Ana Booking' })).status).toBe(400)
  const leaked = await call('POST', `${path}/${missingId}/remove`, undefined, { version: 0, email: 'booking@example.test' })
  expect(leaked.status).toBe(400)
  expect(await leaked.text()).not.toContain('booking@example.test')

  expect((await call('GET', path)).status).toBe(401)
  expect((await call('POST', path, undefined, { name: 'Ana Booking', phone: '+385911110364' })).status).toBe(401)
  expect((await call('PATCH', `${path}/${missingId}`, undefined, { phone: '+385911110000', version: 0 })).status).toBe(401)
  expect((await call('POST', `${path}/${missingId}/remove`, undefined, { version: 0 })).status).toBe(401)
})

it('an office member can add, correct, list, and remove a contact person, and a driver is refused', async () => {
  const firm = await office('hcp-roles')
  const path = `/api/clients/${firm.client.id}/contact-persons`
  const body = { name: '  Ana Booking  ', role: '  booking  ', phone: ' +385911110364 ', email: ' booking@example.test ' }

  expect((await call('GET', path, firm.driver)).status).toBe(403)
  expect((await call('POST', path, firm.driver, body)).status).toBe(403)
  expect(await clientVersion(firm.client.id)).toBe(0)

  const added = await call('POST', path, firm.dispatcher, body)
  expect(added.status).toBe(200)
  const person = await added.json() as ContactBody
  expect(person).toEqual({
    id: expect.any(String),
    clientId: firm.client.id,
    name: 'Ana Booking',
    role: 'booking',
    phone: '+385911110364',
    email: 'booking@example.test',
    version: 0,
    changedAt: null,
    changedByName: null,
  })
  expect(await clientVersion(firm.client.id)).toBe(0)

  const second = await call('POST', path, firm.admin, { name: 'Iva Accounts', email: 'accounts@example.test' })
  expect(second.status).toBe(200)
  const other = await second.json() as ContactBody

  const listed = await call('GET', path, firm.admin)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({ contactPersons: [person, { ...other, version: 0, changedAt: null, changedByName: null }] })

  const same = await call('PATCH', `${path}/${person.id}`, firm.dispatcher, { name: 'Ana Booking', version: 0 })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(person)
  expect((await auditRows(firm.created.tenantId)).map(row => row.action)).toEqual(['contact_person.added', 'contact_person.added'])

  const corrected = await call('PATCH', `${path}/${person.id}`, firm.admin, { name: 'Iva Accounts Desk', phone: null, version: 0 })
  expect(corrected.status).toBe(200)
  const saved = await corrected.json() as ContactBody
  expect(saved).toMatchObject({
    id: person.id,
    name: 'Iva Accounts Desk',
    role: 'booking',
    phone: null,
    email: 'booking@example.test',
    version: 1,
    changedByName: 'Hana Admin',
  })
  expect(saved.changedAt).toEqual(expect.any(String))
  expect(await clientVersion(firm.client.id)).toBe(0)

  expect((await call('PATCH', `${path}/${person.id}`, firm.driver, { name: 'Nope', version: 1 })).status).toBe(403)
  expect((await call('POST', `${path}/${person.id}/remove`, firm.driver, { version: 1 })).status).toBe(403)
  expect((await contactStamp(person.id)).name).toBe('Iva Accounts Desk')

  expect((await call('PATCH', `${path}/${missingId}`, firm.admin, { name: 'Gone', version: 0 })).status).toBe(404)
  expect((await call('GET', `/api/clients/${missingId}/contact-persons`, firm.admin)).status).toBe(404)
  expect((await call('POST', `/api/clients/${missingId}/contact-persons`, firm.admin, { name: 'Ana Booking', phone: '+385911110364' })).status).toBe(404)

  const removed = await call('POST', `${path}/${person.id}/remove`, firm.dispatcher, { version: 1 })
  expect(removed.status).toBe(200)
  expect(await removed.json()).toEqual({ id: person.id })
  expect((await contactStamp(person.id)).removed_at).toBeInstanceOf(Date)
  expect(await clientVersion(firm.client.id)).toBe(0)

  const after = await call('GET', path, firm.dispatcher)
  expect(await after.json()).toEqual({ contactPersons: [other] })
  // The stored version moved on with the removal. The version the form still holds is not found.
  expect((await call('POST', `${path}/${person.id}/remove`, firm.admin, { version: 2 })).status).toBe(404)

  const rows = await auditRows(firm.created.tenantId)
  expect(rows.map(row => row.action).sort()).toEqual([
    'contact_person.added',
    'contact_person.added',
    'contact_person.changed',
    'contact_person.removed',
  ])
  expect(rows.every(row => row.subject_user_id === null)).toBe(true)
  const dataOf = (action: string, contactPersonId: string) =>
    rows.find(row => row.action === action && (row.data as { contactPersonId?: string }).contactPersonId === contactPersonId)?.data
  expect(dataOf('contact_person.added', person.id)).toEqual({ clientId: firm.client.id, contactPersonId: person.id, fields: ['name', 'role', 'phone', 'email'] })
  expect(dataOf('contact_person.added', other.id)).toEqual({ clientId: firm.client.id, contactPersonId: other.id, fields: ['name', 'email'] })
  expect(dataOf('contact_person.changed', person.id)).toEqual({ clientId: firm.client.id, contactPersonId: person.id, fields: ['name', 'phone'] })
  expect(dataOf('contact_person.removed', person.id)).toEqual({ clientId: firm.client.id, contactPersonId: person.id, fields: ['removed'] })
  const text = JSON.stringify(rows)
  expect(text).not.toContain('Ana Booking')
  expect(text).not.toContain('Iva Accounts')
  expect(text).not.toContain('booking')
  expect(text).not.toContain('+385911110364')
  expect(text).not.toContain('booking@example.test')
  expect(text).not.toContain('accounts@example.test')
})

it('refuses a stale correction and a stale removal, writes nothing, and leaves the Client version', async () => {
  const firm = await office('hcp-stale')
  const path = `/api/clients/${firm.client.id}/contact-persons`
  const added = await call('POST', path, firm.dispatcher, { name: 'Ana Booking', phone: '+385911110364' })
  expect(added.status).toBe(200)
  const person = await added.json() as ContactBody
  const saved = await call('PATCH', `${path}/${person.id}`, firm.dispatcher, { name: 'Iva Accounts', version: 0 })
  expect(saved.status).toBe(200)
  const before = await auditRows(firm.created.tenantId)
  const stampBefore = await contactStamp(person.id)

  const staleSame = await call('PATCH', `${path}/${person.id}`, firm.admin, { name: 'Iva Accounts', version: 0 })
  expect(staleSame.status).toBe(409)
  expect(await staleSame.text()).toContain('stale_save')

  const staleChange = await call('PATCH', `${path}/${person.id}`, firm.admin, { name: 'Skriveni Naziv', email: 'hidden@example.test', version: 0 })
  expect(staleChange.status).toBe(409)
  const text = await staleChange.text()
  expect(text).toContain('stale_save')
  expect(text).not.toContain('Skriveni Naziv')
  expect(text).not.toContain('hidden@example.test')
  expect(text).not.toContain('Dino Dispatcher')
  expect(text).not.toContain(firm.dispatcherId)

  const staleRemove = await call('POST', `${path}/${person.id}/remove`, firm.admin, { version: 0 })
  expect(staleRemove.status).toBe(409)
  expect(await staleRemove.text()).toContain('stale_save')

  expect(await contactStamp(person.id)).toEqual(stampBefore)
  expect(stampBefore.removed_at).toBeNull()
  expect(await auditRows(firm.created.tenantId)).toEqual(before)
  expect(await clientVersion(firm.client.id)).toBe(0)
  const listed = await call('GET', path, firm.admin)
  expect(await listed.json()).toMatchObject({ contactPersons: [{ id: person.id, name: 'Iva Accounts', version: 1 }] })
})

it('a correction that changes nothing appends no audit entry', async () => {
  const firm = await office('hcp-noop')
  const path = `/api/clients/${firm.client.id}/contact-persons`
  const added = await call('POST', path, firm.admin, { name: 'Ana Booking', role: 'booking', phone: '+385911110364' })
  const person = await added.json() as ContactBody
  const before = await auditRows(firm.created.tenantId)

  const same = await call('PATCH', `${path}/${person.id}`, firm.dispatcher, {
    name: 'Ana Booking',
    role: 'booking',
    phone: '+385911110364',
    version: 0,
  })
  expect(same.status).toBe(200)
  expect(await same.json()).toMatchObject({ id: person.id, version: 0, changedAt: null, changedByName: null })
  expect(await auditRows(firm.created.tenantId)).toEqual(before)
  expect(await clientVersion(firm.client.id)).toBe(0)
})

it('clearing the last phone and email is refused and writes nothing', async () => {
  const firm = await office('hcp-reach')
  const path = `/api/clients/${firm.client.id}/contact-persons`
  const added = await call('POST', path, firm.admin, { name: 'Ana Booking', phone: '+385911110364' })
  const person = await added.json() as ContactBody
  const before = await auditRows(firm.created.tenantId)

  const cleared = await call('PATCH', `${path}/${person.id}`, firm.dispatcher, { phone: null, version: 0 })
  expect(cleared.status).toBe(400)
  expect(await contactStamp(person.id)).toMatchObject({ phone: '+385911110364', version: 0, removed_at: null })
  expect(await auditRows(firm.created.tenantId)).toEqual(before)
})

it('another Tenant cannot read or write this Client\'s contact persons', async () => {
  const first = await office('hcp-a')
  const second = await office('hcp-b')
  const path = `/api/clients/${first.client.id}/contact-persons`
  const added = await call('POST', path, first.admin, { name: 'Ana Booking', phone: '+385911110364' })
  expect(added.status).toBe(200)
  const person = await added.json() as ContactBody

  expect((await call('GET', path, second.admin)).status).toBe(404)
  expect((await call('POST', path, second.admin, { name: 'Taken', phone: '+385911110000' })).status).toBe(404)
  expect((await call('PATCH', `${path}/${person.id}`, second.admin, { name: 'Taken', version: 0 })).status).toBe(404)
  expect((await call('POST', `${path}/${person.id}/remove`, second.admin, { version: 0 })).status).toBe(404)

  const own = `/api/clients/${second.client.id}/contact-persons/${person.id}`
  expect((await call('PATCH', own, second.admin, { name: 'Taken', version: 0 })).status).toBe(404)
  expect((await call('POST', `${own}/remove`, second.admin, { version: 0 })).status).toBe(404)

  const kept = await call('GET', path, first.dispatcher)
  expect(await kept.json()).toEqual({ contactPersons: [person] })
  expect(await contactStamp(person.id)).toMatchObject({ name: 'Ana Booking', removed_at: null })
  expect(first.created.tenantId).not.toBe(second.created.tenantId)
})
