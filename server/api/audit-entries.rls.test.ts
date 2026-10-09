import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getAuditEntries from './audit-entries.get'

/**
 * GET /api/audit-entries. Admin only. A Dispatcher receives 403 from the
 * route, the same refusal the member role-change and removal routes give.
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
const password = 'audit-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/audit-entries', event => getAuditEntries(event))
const callAudit = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hae-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hae-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hae-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hae-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hae-%'`)
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

it('a dispatcher receives 403 from GET /api/audit-entries', async () => {
  const created = await createTenant({
    name: 'Tenant hae-read',
    slug: 'hae-read',
    adminEmail: 'hae-read-admin@example.test',
    adminName: 'Hana Admin',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  await addMember(created.tenantId, 'hae-read-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('hae-read-dispatcher@example.test')

  const refused = await callAudit(new Request('http://localhost/api/audit-entries', {
    method: 'GET',
    headers: dispatcher,
  }))
  expect(refused.status).toBe(403)
  const text = await refused.text()
  expect(text).not.toContain('hae-read-admin@example.test')
  expect(text).not.toContain('hae-read-dispatcher@example.test')
  expect(text).not.toContain('Hana Admin')
  expect(text).not.toContain('Dino Dispatcher')
})
