import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getClients from './clients.get'
import postClient from './clients.post'
import getNote from './clients/[id]/note.get'
import putNote from './clients/[id]/note.put'

/**
 * The Client note through the route handlers (ADR-0049). An invalid body is
 * answered before a session exists. The role cases use a real sign-in.
 * The slug prefix is `hcn-` so cleanup does not touch the Client suite's `hcl-` firms.
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
const password = 'note-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')
const missingId = '9e4b3f6d-5555-4555-8555-555555555555'
const note = 'Gosti se čekaju na izlazu.'

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
  if (parts[1] === 'note' && parts.length === 2) {
    event.context.params = { id }
    if (event.method === 'PUT')
      return putNote(event)
    return getNote(event)
  }
  throw new Error(`unmapped ${event.method} ${event.path}`)
})
const callClients = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.client_notes where tenant_id::text in (
      select id from auth.organization where slug like 'hcn-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hcn-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hcn-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hcn-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hcn-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hcn-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hcn-%'`)
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

interface NoteBody {
  clientId: string
  note: string | null
  version: number | null
  changedAt: string | null
  changedByName: string | null
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text = 'client_note.saved'
     order by occurred_at, id`,
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

async function noteStamp(clientId: string) {
  const result = await ownerPool.query<{ note: string | null, version: number }>(
    'select note, version from app.client_notes where client_id = $1',
    [clientId],
  )
  return result.rows[0] ?? null
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
  const client = await added.json() as { id: string }
  return { created, dispatcherId, admin, dispatcher, driver, client }
}

it('answers 400 for a bad body or a bad id, and 401 when nobody is signed in', async () => {
  const path = `/api/clients/${missingId}/note`
  expect((await call('PUT', path, undefined, {})).status).toBe(400)
  expect((await call('PUT', path, undefined, { note: 'A'.repeat(2001) })).status).toBe(400)
  expect((await call('PUT', path, undefined, { note, version: -1 })).status).toBe(400)
  expect((await call('PUT', path, undefined, { note, version: '1' })).status).toBe(400)
  const unknown = await call('PUT', path, undefined, { note, text: 'Skriveni tekst' })
  expect(unknown.status).toBe(400)
  expect(await unknown.text()).not.toContain('Skriveni tekst')
  expect((await call('PUT', '/api/clients/not-a-uuid/note', undefined, { note })).status).toBe(400)
  expect((await call('GET', '/api/clients/not-a-uuid/note')).status).toBe(400)

  expect((await call('GET', path)).status).toBe(401)
  expect((await call('PUT', path, undefined, { note })).status).toBe(401)
})

it('an office member can read, save, correct, and clear a note, and a driver is refused', async () => {
  const firm = await office('hcn-roles')
  const path = `/api/clients/${firm.client.id}/note`

  expect((await call('GET', path, firm.driver)).status).toBe(403)
  expect((await call('PUT', path, firm.driver, { note })).status).toBe(403)
  expect(await clientVersion(firm.client.id)).toBe(0)
  expect(await noteStamp(firm.client.id)).toBeNull()

  const empty = await call('GET', path, firm.dispatcher)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toEqual({
    clientId: firm.client.id,
    note: null,
    version: null,
    changedAt: null,
    changedByName: null,
  })

  const added = await call('PUT', path, firm.dispatcher, { note: `  ${note}  ` })
  expect(added.status).toBe(200)
  const first = await added.json() as NoteBody
  expect(first).toMatchObject({
    clientId: firm.client.id,
    note,
    version: 1,
    changedByName: 'Dino Dispatcher',
  })
  expect(first.changedAt).toEqual(expect.any(String))
  expect(await clientVersion(firm.client.id)).toBe(0)

  const same = await call('PUT', path, firm.admin, { note, version: 1 })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(first)
  expect(await auditRows(firm.created.tenantId)).toEqual([
    {
      action: 'client_note.saved',
      subject_user_id: null,
      data: { clientId: firm.client.id, fields: ['note'] },
    },
  ])

  const corrected = await call('PUT', path, firm.admin, { note: 'Plaćanje do 15. u mjesecu.', version: 1 })
  expect(corrected.status).toBe(200)
  const saved = await corrected.json() as NoteBody
  expect(saved).toMatchObject({
    clientId: firm.client.id,
    note: 'Plaćanje do 15. u mjesecu.',
    version: 2,
    changedByName: 'Hana Admin',
  })
  expect(saved.changedAt).toEqual(expect.any(String))
  expect(await clientVersion(firm.client.id)).toBe(0)

  const cleared = await call('PUT', path, firm.dispatcher, { note: '   ', version: 2 })
  expect(cleared.status).toBe(200)
  const emptyText = await cleared.json() as NoteBody
  expect(emptyText).toMatchObject({
    clientId: firm.client.id,
    note: null,
    version: 3,
    changedByName: 'Dino Dispatcher',
  })
  expect(await noteStamp(firm.client.id)).toEqual({ note: null, version: 3 })
  expect(await clientVersion(firm.client.id)).toBe(0)

  expect((await call('GET', `/api/clients/${missingId}/note`, firm.admin)).status).toBe(404)
  expect((await call('PUT', `/api/clients/${missingId}/note`, firm.admin, { note })).status).toBe(404)

  const rows = await auditRows(firm.created.tenantId)
  expect(rows.map(row => row.data)).toEqual([
    { clientId: firm.client.id, fields: ['note'] },
    { clientId: firm.client.id, fields: ['note'] },
    { clientId: firm.client.id, fields: ['note'] },
  ])
  const text = JSON.stringify(rows)
  expect(text).not.toContain(note)
  expect(text).not.toContain('Plaćanje do 15. u mjesecu.')
  expect(text).not.toContain('Dino Dispatcher')
  expect(text).not.toContain(firm.dispatcherId)
})

it('a second first save that loses the race writes nothing and appends no audit entry', async () => {
  const firm = await office('hcn-race')
  const path = `/api/clients/${firm.client.id}/note`
  const [left, right] = await Promise.all([
    call('PUT', path, firm.dispatcher, { note: 'Prva napomena' }),
    call('PUT', path, firm.admin, { note: 'Druga napomena koja ne smije procuriti' }),
  ])
  const statuses = [left.status, right.status].sort()
  expect(statuses).toEqual([200, 409])
  const lost = left.status === 409 ? left : right
  const lostText = await lost.text()
  expect(lostText).toContain('stale_save')
  expect(lostText).not.toContain('Prva napomena')
  expect(lostText).not.toContain('Druga napomena koja ne smije procuriti')
  expect(lostText).not.toContain('Dino Dispatcher')
  expect(lostText).not.toContain('Hana Admin')
  expect(lostText).not.toContain(firm.dispatcherId)

  const stored = await noteStamp(firm.client.id)
  expect(stored?.version).toBe(1)
  expect(stored?.note === 'Prva napomena' || stored?.note === 'Druga napomena koja ne smije procuriti').toBe(true)
  expect(await auditRows(firm.created.tenantId)).toHaveLength(1)
  expect(await clientVersion(firm.client.id)).toBe(0)

  const again = await call('PUT', path, firm.dispatcher, { note: 'Treća napomena' })
  expect(again.status).toBe(409)
  expect(await again.text()).not.toContain('Treća napomena')
  expect(await noteStamp(firm.client.id)).toEqual(stored)
  expect(await auditRows(firm.created.tenantId)).toHaveLength(1)

  const read = await call('GET', path, firm.admin)
  const body = await read.json() as NoteBody
  expect(body.version).toBe(1)
  expect(body.changedAt).toEqual(expect.any(String))
  expect(body.changedByName === 'Dino Dispatcher' || body.changedByName === 'Hana Admin').toBe(true)
})

it('refuses a stale correction, writes nothing, and leaves who and when on the note', async () => {
  const firm = await office('hcn-stale')
  const path = `/api/clients/${firm.client.id}/note`
  const added = await call('PUT', path, firm.dispatcher, { note })
  expect(added.status).toBe(200)
  const first = await added.json() as NoteBody
  const saved = await call('PUT', path, firm.dispatcher, { note: 'Plaćanje do 15.', version: first.version })
  expect(saved.status).toBe(200)
  const current = await saved.json() as NoteBody
  const before = await auditRows(firm.created.tenantId)
  const stampBefore = await noteStamp(firm.client.id)

  const staleSame = await call('PUT', path, firm.admin, { note: 'Plaćanje do 15.', version: first.version })
  expect(staleSame.status).toBe(409)
  expect(await staleSame.text()).toContain('stale_save')

  const staleChange = await call('PUT', path, firm.admin, { note: 'Skriveni tekst', version: first.version })
  expect(staleChange.status).toBe(409)
  const text = await staleChange.text()
  expect(text).toContain('stale_save')
  expect(text).not.toContain('Skriveni tekst')
  expect(text).not.toContain('Dino Dispatcher')
  expect(text).not.toContain(firm.dispatcherId)

  expect(await noteStamp(firm.client.id)).toEqual(stampBefore)
  expect(await auditRows(firm.created.tenantId)).toEqual(before)
  expect(await clientVersion(firm.client.id)).toBe(0)
  const listed = await call('GET', path, firm.admin)
  expect(await listed.json()).toEqual(current)
  expect(current.changedByName).toBe('Dino Dispatcher')
  expect(current.changedAt).toEqual(expect.any(String))
})

it('a save that changes nothing appends no audit entry', async () => {
  const firm = await office('hcn-noop')
  const path = `/api/clients/${firm.client.id}/note`
  const added = await call('PUT', path, firm.admin, { note })
  const first = await added.json() as NoteBody
  const before = await auditRows(firm.created.tenantId)

  const same = await call('PUT', path, firm.dispatcher, { note: `  ${note}  `, version: 1 })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(first)
  expect(await auditRows(firm.created.tenantId)).toEqual(before)
  expect(await clientVersion(firm.client.id)).toBe(0)
  expect(await noteStamp(firm.client.id)).toEqual({ note, version: 1 })
})

it('another Tenant cannot read or write this Client\'s note', async () => {
  const first = await office('hcn-a')
  const second = await office('hcn-b')
  const path = `/api/clients/${first.client.id}/note`
  const added = await call('PUT', path, first.admin, { note })
  expect(added.status).toBe(200)

  expect((await call('GET', path, second.admin)).status).toBe(404)
  expect((await call('PUT', path, second.admin, { note: 'Tuđa napomena' })).status).toBe(404)
  expect((await call('PUT', path, second.admin, { note: 'Tuđa napomena', version: 1 })).status).toBe(404)

  const kept = await call('GET', path, first.dispatcher)
  expect(await kept.json()).toMatchObject({ clientId: first.client.id, note, version: 1 })
  expect(await noteStamp(first.client.id)).toEqual({ note, version: 1 })
  expect(await noteStamp(second.client.id)).toBeNull()
  expect(first.created.tenantId).not.toBe(second.created.tenantId)
})
