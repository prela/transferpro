import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { openTenantSession } from '../core/index'
import { loadActivePartnerIds, partnerIsActive } from '../modules/partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getPartners from './partners.get'
import postPartner from './partners.post'
import patchPartner from './partners/[id].patch'
import archivePartner from './partners/[id]/archive.post'
import restorePartner from './partners/[id]/restore.post'

/**
 * GET, POST, PATCH /api/partners, POST /api/partners/:id/archive, and
 * POST /api/partners/:id/restore.
 * An invalid body is answered before a session exists. The role cases use
 * a real sign-in, the same way the screen will call these routes.
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
const password = 'partners-http-password'
const phone = '+385911119379'
const email = 'office-379@mora.example'
const note = 'Call the desk 379'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: required('DATABASE_URL') })
const appDb = drizzle(appPool)
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/partners', (event) => {
  const pathOnly = event.path.split('?')[0] ?? '/'
  const rest = pathOnly === '/' ? '' : decodeURIComponent(pathOnly.slice(1))
  if (rest === '') {
    if (event.method === 'POST')
      return postPartner(event)
    return getPartners(event)
  }
  const [id, action] = rest.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'archive')
    return archivePartner(event)
  if (action === 'restore')
    return restorePartner(event)
  return patchPartner(event)
})
const callPartners = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.partners where tenant_id::text in (
      select id from auth.organization where slug like 'hpt-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hpt-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hpt-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hpt-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hpt-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hpt-%'`)
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
  await appPool.end()
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

async function addMember(tenantId: string, emailAddress: string, name: string, role: TenantRole): Promise<string> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, name, emailAddress],
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

async function signIn(emailAddress: string): Promise<Headers> {
  const response = await handleAuthRequest(new Request(new URL('/api/auth/sign-in/email', authUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailAddress, password }),
  }))
  if (!response.ok)
    throw new Error(`sign-in status ${response.status}`)
  return new Headers({ cookie: response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ') })
}

function call(method: string, path: string, session?: Headers, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return callPartners(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function partnerBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Mora Transfer',
    phone,
    email,
    note,
    ...overrides,
  }
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'partner.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

it('post answers 400 for a bad body and does not echo the phone, and no session is 401', async () => {
  expect((await call('POST', '/api/partners', undefined, partnerBody({ name: '   ' }))).status).toBe(400)
  expect((await call('POST', '/api/partners', undefined, partnerBody({ email: 'not-an-email' }))).status).toBe(400)
  expect((await call('POST', '/api/partners', undefined, partnerBody({ note: 'n'.repeat(2001) }))).status).toBe(400)
  const unknown = await call('POST', '/api/partners', undefined, partnerBody({ kind: 'agency' }))
  expect(unknown.status).toBe(400)
  const unknownText = await unknown.text()
  expect(unknownText).not.toContain(phone)
  expect(unknownText).not.toContain(email)
  expect(unknownText).not.toContain(note)
  expect(unknownText).not.toContain('Mora Transfer')
  expect((await call('PATCH', '/api/partners/not-a-uuid', undefined, { name: 'Jug' })).status).toBe(400)
  expect((await call('GET', '/api/partners')).status).toBe(401)
  expect((await call('POST', '/api/partners', undefined, partnerBody())).status).toBe(401)
  expect((await call('PATCH', '/api/partners/a1b2c3d4-5555-4555-8555-555555555555', undefined, { name: 'Jug' })).status).toBe(401)
  expect((await call('POST', '/api/partners/a1b2c3d4-5555-4555-8555-555555555555/archive')).status).toBe(401)
  expect((await call('POST', '/api/partners/a1b2c3d4-5555-4555-8555-555555555555/restore')).status).toBe(401)
  expect((await call('GET', '/api/partners?includeArchived=1')).status).toBe(400)
  expect((await call('GET', '/api/partners?includeArchived=')).status).toBe(400)
  expect((await call('GET', '/api/partners?includeArchived=null')).status).toBe(400)
  expect((await call('GET', '/api/partners?includeArchived=True')).status).toBe(400)
  expect((await call('GET', '/api/partners?includeArchived=false')).status).toBe(401)
})

it('a dispatcher and an admin can add, correct, list, archive, and restore a Partner, and a driver is refused', async () => {
  const created = await tenant('hpt-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hpt-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hpt-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hpt-roles-admin@example.test')
  const dispatcher = await signIn('hpt-roles-dispatcher@example.test')
  const driver = await signIn('hpt-roles-driver@example.test')

  const refused = await call('POST', '/api/partners', driver, partnerBody({ name: 'Hidden' }))
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(phone)
  expect((await call('GET', '/api/partners', driver)).status).toBe(403)
  expect((await call('POST', '/api/partners/a1b2c3d4-5555-4555-8555-555555555555/restore', driver)).status).toBe(403)

  const added = await call('POST', '/api/partners', dispatcher, partnerBody({
    name: '  Mora Transfer  ',
    phone: `  ${phone}  `,
    email: `  ${email}  `,
    note: `  ${note}  `,
  }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row).toEqual({
    id: expect.any(String),
    name: 'Mora Transfer',
    phone,
    email,
    note,
    archivedAt: null,
  })

  const sameName = await call('POST', '/api/partners', admin, { name: 'Mora Transfer' })
  expect(sameName.status).toBe(200)
  const twin = await sameName.json()
  expect(twin).toMatchObject({ name: 'Mora Transfer', phone: null, email: null, note: null, archivedAt: null })

  const listed = await call('GET', '/api/partners', admin)
  expect(listed.status).toBe(200)
  const listedIds = ((await listed.json()).partners as Array<{ id: string }>).map(partner => partner.id)
  expect(listedIds).toEqual([row.id, twin.id].sort())

  const same = await call('PATCH', `/api/partners/${row.id}`, dispatcher, { phone })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(row)

  const corrected = await call('PATCH', `/api/partners/${row.id}`, admin, {
    name: 'Jug',
    phone: '',
    note: 'Meet at the gate.',
  })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({
    id: row.id,
    name: 'Jug',
    phone: null,
    email,
    note: 'Meet at the gate.',
    archivedAt: null,
  })

  expect((await call('PATCH', `/api/partners/${row.id}`, driver, { name: 'Hidden' })).status).toBe(403)

  const archived = await call('POST', `/api/partners/${row.id}/archive`, dispatcher)
  expect(archived.status).toBe(200)
  const archivedRow = await archived.json()
  expect(archivedRow.archivedAt).toEqual(expect.any(String))

  const frozen = await call('PATCH', `/api/partners/${row.id}`, admin, { name: 'Mora Transfer' })
  expect(frozen.status).toBe(409)
  const frozenText = await frozen.text()
  expect(frozenText).not.toContain('Jug')
  expect(frozenText).not.toContain(note)
  expect(frozenText).toContain('partner_archived')
  expect(JSON.parse(frozenText)).toMatchObject({ statusCode: 409, data: { code: 'partner_archived' } })

  const hidden = await call('GET', '/api/partners', dispatcher)
  expect((await hidden.json()).partners).toEqual([expect.objectContaining({ id: twin.id })])

  const withArchived = await call('GET', '/api/partners?includeArchived=true', admin)
  const archivedIds = ((await withArchived.json()).partners as Array<{ id: string }>).map(partner => partner.id)
  // Jug sorts before Mora Transfer. The archived row stays in that order.
  expect(archivedIds).toEqual([row.id, twin.id])

  const again = await call('POST', `/api/partners/${row.id}/archive`, admin)
  expect(again.status).toBe(200)
  expect((await again.json()).archivedAt).toBe(archivedRow.archivedAt)

  const restored = await call('POST', `/api/partners/${row.id}/restore`, admin)
  expect(restored.status).toBe(200)
  expect((await restored.json()).archivedAt).toBeNull()

  const stillThere = await call('POST', `/api/partners/${row.id}/restore`, dispatcher)
  expect(stillThere.status).toBe(200)
  expect((await stillThere.json()).archivedAt).toBeNull()

  const back = await call('GET', '/api/partners', dispatcher)
  const backIds = ((await back.json()).partners as Array<{ id: string }>).map(partner => partner.id)
  expect(backIds).toEqual([row.id, twin.id])

  const missing = 'a1b2c3d4-5555-4555-8555-555555555555'
  expect((await call('PATCH', `/api/partners/${missing}`, admin, { name: 'Jug' })).status).toBe(404)
  expect((await call('POST', `/api/partners/${missing}/archive`, admin)).status).toBe(404)
  expect((await call('POST', `/api/partners/${missing}/restore`, admin)).status).toBe(404)

  const rows = await auditRows(created.tenantId)
  expect(rows.every(entry => entry.subject_user_id === null)).toBe(true)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(phone)
  expect(text).not.toContain(email)
  expect(text).not.toContain(note)
  expect(text).not.toContain('Mora Transfer')
  expect(text).not.toContain('Meet at the gate.')
  expect(text).not.toContain('Jug')
  const dataOf = (action: string, partnerId: string) => rows.find(entry => entry.action === action && (entry.data as { partnerId: string }).partnerId === partnerId)?.data
  expect(rows.filter(entry => entry.action === 'partner.created')).toHaveLength(2)
  expect(rows.filter(entry => entry.action === 'partner.changed')).toHaveLength(1)
  expect(rows.filter(entry => entry.action === 'partner.archived')).toHaveLength(1)
  expect(rows.filter(entry => entry.action === 'partner.restored')).toHaveLength(1)
  expect(dataOf('partner.created', row.id)).toEqual({
    partnerId: row.id,
    fields: ['name', 'phone', 'email', 'note'],
  })
  expect(dataOf('partner.created', twin.id)).toEqual({ partnerId: twin.id, fields: ['name'] })
  expect(dataOf('partner.changed', row.id)).toEqual({ partnerId: row.id, fields: ['name', 'phone', 'note'] })
  expect(dataOf('partner.archived', row.id)).toEqual({ partnerId: row.id })
  expect(dataOf('partner.restored', row.id)).toEqual({ partnerId: row.id })
})

it('another Tenant cannot read or change these Partners, and an active id is only this Tenant\'s', async () => {
  const firmA = await tenant('hpt-iso-a', 'Ana Admin')
  const firmB = await tenant('hpt-iso-b', 'Boris Admin')
  const adminA = await signIn('hpt-iso-a-admin@example.test')
  const adminB = await signIn('hpt-iso-b-admin@example.test')

  const added = await call('POST', '/api/partners', adminA, { name: 'Mora Transfer', phone })
  expect(added.status).toBe(200)
  const row = await added.json()
  const other = await call('POST', '/api/partners', adminB, { name: 'Jug' })
  expect(other.status).toBe(200)
  const otherRow = await other.json()

  expect(await (await call('GET', '/api/partners', adminB)).json()).toEqual({
    partners: [expect.objectContaining({ id: otherRow.id, name: 'Jug' })],
  })
  expect((await call('PATCH', `/api/partners/${row.id}`, adminB, { name: 'Stolen' })).status).toBe(404)
  expect((await call('POST', `/api/partners/${row.id}/archive`, adminB)).status).toBe(404)
  expect((await call('POST', `/api/partners/${row.id}/restore`, adminB)).status).toBe(404)
  expect(await (await call('GET', '/api/partners', adminA)).json()).toEqual({
    partners: [expect.objectContaining({ id: row.id, name: 'Mora Transfer', phone })],
  })

  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: firmA.tenantId }, async () => {
      expect(await loadActivePartnerIds(transaction)).toEqual([row.id])
      expect(await partnerIsActive(transaction, row.id)).toBe(true)
      expect(await partnerIsActive(transaction, otherRow.id)).toBe(false)
    })
  })
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: firmB.tenantId }, async () => {
      expect(await loadActivePartnerIds(transaction)).toEqual([otherRow.id])
      expect(await partnerIsActive(transaction, row.id)).toBe(false)
    })
  })

  await call('POST', `/api/partners/${row.id}/archive`, adminA)
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: firmA.tenantId }, async () => {
      expect(await loadActivePartnerIds(transaction)).toEqual([])
      expect(await partnerIsActive(transaction, row.id)).toBe(false)
    })
  })
})
