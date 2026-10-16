import type { H3Event } from 'h3'
import type { TenantRole } from '../../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { auditEntryListSchema, inviteResultSchema } from '../../../shared'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../../modules/tenancy'
import getAuditEntries from '../audit-entries.get'
import revokeInvitation from './[invitationId]/revoke.post'
import acceptInvitation from './accept.post'
import getPending from './index.get'
import postInvitation from './index.post'

/**
 * GET /api/invitations and POST /api/invitations/:id/revoke.
 * The Tenant and the Admin allow-list come from the session. The list calls
 * Better Auth on the server. Its HTTP list route stays disabled.
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
const authUrl = required('BETTER_AUTH_URL')
const password = 'pending-invite-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })

const pendingListSchema = z.object({
  invitations: z.array(z.object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(['admin', 'dispatcher', 'driver']),
    expiresAt: z.iso.datetime(),
  })),
})

const app = createApp()
app.use('/api', (event) => {
  const parts = apiPath(event)
  if (parts[0] === 'audit-entries' && parts.length === 1 && event.method === 'GET')
    return getAuditEntries(event)
  if (parts[0] !== 'invitations')
    return new Response('Not Found', { status: 404 })
  if (parts.length === 1 && event.method === 'GET')
    return getPending(event)
  if (parts.length === 1 && event.method === 'POST')
    return postInvitation(event)
  if (parts.length === 2 && parts[1] === 'accept' && event.method === 'POST')
    return acceptInvitation(event)
  if (parts.length === 3 && parts[2] === 'revoke' && event.method === 'POST') {
    event.context.params = { invitationId: decodeURIComponent(parts[1] ?? '') }
    return revokeInvitation(event)
  }
  return new Response('Not Found', { status: 404 })
})
const callApp = toWebHandler(app)

beforeAll(async () => {
  await removeFixtures()
})

afterAll(async () => {
  await removeFixtures()
  await closeTenantRuntime()
  await authPool.end()
  await ownerPool.end()
})

it('an admin lists only their tenant\'s pending invitations', async () => {
  const created = await tenant('pir-list', 'Pia Admin')
  const admin = await signIn('pir-list-admin@example.test')
  const liveId = await invite(admin, 'pir-list-live@example.test', 'dispatcher')
  const acceptedId = await invite(admin, 'pir-list-accepted@example.test', 'driver')
  const expiredId = await invite(admin, 'pir-list-expired@example.test', 'driver')
  await authPool.query(
    `update auth.invitation set expires_at = now() - interval '1 minute' where id = $1`,
    [expiredId],
  )
  const accepted = await call('POST', '/api/invitations/accept', undefined, {
    invitationId: acceptedId,
    name: 'Pia Accepted',
    password,
  })
  expect(accepted.status).toBe(200)

  const other = await tenant('pir-list-other', 'Petar Admin')
  const otherAdmin = await signIn('pir-list-other-admin@example.test')
  await invite(otherAdmin, 'pir-list-foreign@example.test', 'driver')

  const listed = await call('GET', `/api/invitations?organizationId=${other.tenantId}`, admin)
  expect(listed.status).toBe(200)
  const body = pendingListSchema.parse(await listed.json())
  expect(body.invitations).toHaveLength(1)
  expect(body.invitations[0]).toMatchObject({
    id: liveId,
    email: 'pir-list-live@example.test',
    role: 'dispatcher',
  })
  expect(Object.keys(body.invitations[0] ?? {}).sort()).toEqual(['email', 'expiresAt', 'id', 'role'])
  expect(new Date(body.invitations[0]?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now())
  expect(JSON.stringify(body)).not.toContain('pir-list-accepted@example.test')
  expect(JSON.stringify(body)).not.toContain('pir-list-expired@example.test')
  expect(JSON.stringify(body)).not.toContain('pir-list-foreign@example.test')
  expect(JSON.stringify(body)).not.toContain(other.tenantId)
  expect(created.tenantId).not.toBe(other.tenantId)
})

it('an admin revoke stops the link, drops it from the list, and records the role without the email', async () => {
  const created = await tenant('pir-revoke', 'Roko Admin')
  const admin = await signIn('pir-revoke-admin@example.test')
  const email = 'pir-revoke-guest@example.test'
  const invitationId = await invite(admin, email, 'driver')

  const revoked = await call('POST', `/api/invitations/${invitationId}/revoke`, admin)
  expect(revoked.status).toBe(200)
  expect(await revoked.json()).toEqual({ revoked: true })

  const listed = await call('GET', '/api/invitations', admin)
  expect(pendingListSchema.parse(await listed.json()).invitations).toEqual([])

  const accepted = await call('POST', '/api/invitations/accept', undefined, {
    invitationId,
    name: 'Roko Guest',
    password,
  })
  expect(accepted.status).toBe(400)
  const acceptBody = await accepted.text()
  expect(acceptBody).not.toContain(email)
  expect(acceptBody).not.toContain(invitationId)

  const again = await call('POST', '/api/invitations', admin, { email, role: 'dispatcher' })
  expect(again.status).toBe(200)
  const nextId = new URL(inviteResultSchema.parse(await again.json()).inviteUrl).hash.slice(1)
  expect(nextId).not.toBe(invitationId)
  const after = pendingListSchema.parse(await (await call('GET', '/api/invitations', admin)).json())
  expect(after.invitations.map(row => row.id)).toEqual([nextId])

  const audit = await call('GET', '/api/audit-entries', admin)
  expect(audit.status).toBe(200)
  const entry = auditEntryListSchema.parse(await audit.json()).entries.find(row => row.action === 'member.invitation_revoked')
  expect(entry).toMatchObject({
    actorUserId: created.adminUserId,
    subjectUserId: null,
    data: { role: 'driver' },
  })
  const stored = JSON.stringify(entry)
  expect(stored).not.toContain(email)
  expect(stored).not.toContain(invitationId)
})

it('a dispatcher, a driver, and a signed-out request are refused on both routes', async () => {
  const created = await tenant('pir-role', 'Rita Admin')
  await addMember(created.tenantId, 'pir-role-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'pir-role-driver@example.test', 'Dario Driver', 'driver')
  const admin = await signIn('pir-role-admin@example.test')
  const invitationId = await invite(admin, 'pir-role-guest@example.test', 'driver')
  const dispatcher = await signIn('pir-role-dispatcher@example.test')
  const driver = await signIn('pir-role-driver@example.test')

  for (const session of [dispatcher, driver, undefined]) {
    const listed = await call('GET', '/api/invitations', session)
    expect(listed.status).toBe(session === undefined ? 401 : 403)
    expect(await listed.text()).not.toContain('pir-role-guest@example.test')
    const revoked = await call('POST', `/api/invitations/${invitationId}/revoke`, session)
    expect(revoked.status).toBe(session === undefined ? 401 : 403)
    const revokedBody = await revoked.text()
    expect(revokedBody).not.toContain('pir-role-guest@example.test')
    expect(revokedBody).not.toContain(invitationId)
  }

  const still = pendingListSchema.parse(await (await call('GET', '/api/invitations', admin)).json())
  expect(still.invitations.map(row => row.id)).toEqual([invitationId])
})

it('another tenant\'s invitation is missing, the same as an unknown id', async () => {
  await tenant('pir-cross-a', 'Ana Admin')
  await tenant('pir-cross-b', 'Borna Admin')
  const adminA = await signIn('pir-cross-a-admin@example.test')
  const adminB = await signIn('pir-cross-b-admin@example.test')
  const foreignId = await invite(adminB, 'pir-cross-foreign@example.test', 'dispatcher')
  const missingId = crypto.randomUUID()

  const foreign = await call('POST', `/api/invitations/${foreignId}/revoke`, adminA)
  const missing = await call('POST', `/api/invitations/${missingId}/revoke`, adminA)
  expect(foreign.status).toBe(missing.status)
  expect(foreign.status).toBe(404)
  const foreignBody = await foreign.text()
  expect(foreignBody).toBe(await missing.text())
  expect(foreignBody).not.toContain('pir-cross-foreign@example.test')

  const stillTheirs = pendingListSchema.parse(await (await call('GET', '/api/invitations', adminB)).json())
  expect(stillTheirs.invitations.map(row => row.email)).toEqual(['pir-cross-foreign@example.test'])
  const ours = pendingListSchema.parse(await (await call('GET', '/api/invitations', adminA)).json())
  expect(ours.invitations).toEqual([])
})

it('rejects an invitation id that is not a uuid before reading the session', async () => {
  const refused = await call('POST', '/api/invitations/not-a-uuid/revoke')
  expect(refused.status).toBe(400)
})

it('keeps Better Auth\'s list-invitations HTTP route disabled', async () => {
  const created = await tenant('pir-http', 'Hana Admin')
  const admin = await signIn('pir-http-admin@example.test')
  const response = await handleAuthRequest(new Request(
    new URL(`/api/auth/organization/list-invitations?organizationId=${created.tenantId}`, authUrl),
    { headers: { cookie: admin.get('cookie') ?? '', origin: authUrl } },
  ))
  expect(response.status).toBe(404)
})

function apiPath(event: H3Event): string[] {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '') || '/'
  const marker = '/api'
  const relative = pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly
  return relative.split('/').filter(part => part !== '')
}

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

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<void> {
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

async function invite(session: Headers, email: string, role: TenantRole): Promise<string> {
  const created = await call('POST', '/api/invitations', session, { email, role })
  expect(created.status).toBe(200)
  return new URL(inviteResultSchema.parse(await created.json()).inviteUrl).hash.slice(1)
}

async function removeFixtures() {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'pir-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'pir-%@example.test')`)
    await auth.query(`delete from auth.invitation where organization_id in (select id from auth.organization where slug like 'pir-%')`)
    await auth.query(`delete from auth.member where organization_id in (select id from auth.organization where slug like 'pir-%')
      or user_id in (select id from auth."user" where email like 'pir-%@example.test')`)
    await auth.query(`delete from auth.account where user_id in (select id from auth."user" where email like 'pir-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'pir-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'pir-%'`)
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
}
