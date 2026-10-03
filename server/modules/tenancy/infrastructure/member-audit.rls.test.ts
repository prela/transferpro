import type { TenantRole } from '../../../../shared'
import type { AuthHandle } from './auth'
import type { Actor } from './session'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { changeMemberRole, closeTenantRuntime, inviteMember, readAuditLog, removeTenantMember } from '..'
import { createAuth } from './auth'
import { createTenant } from './create-tenant'
import { changeMemberRole as changeMemberRoleImpl, removeMember as removeMemberImpl } from './member-management'

/**
 * Member actions and the audit log (ADR-0014). Calls go through the module's
 * session functions, as the routes do. Entries are counted as the owner, so
 * the count does not depend on the policy under test. Each test has its own
 * Tenant, because entries cannot be deleted between runs.
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
const password = 'member-audit-password'

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const handle: AuthHandle = createAuth({
  AUTH_DATABASE_URL: authDatabaseUrl,
  BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
  BETTER_AUTH_URL: required('BETTER_AUTH_URL'),
})

beforeAll(async () => {
  const auth = await authPool.connect()
  try {
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'ma-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'ma-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'ma-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'ma-%'`)
    await auth.query('commit')
  }
  catch (error) {
    await auth.query('rollback')
    throw error
  }
  finally {
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

/** A credential user with one membership. `role` is stored as given, so a test can store one the log cannot show. */
async function addMember(tenantId: string, email: string, name: string, role: TenantRole | 'owner'): Promise<string> {
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

async function roleIn(tenantId: string, userId: string): Promise<string | undefined> {
  return (await handle.memberships(userId)).find(member => member.organizationId === tenantId)?.role
}

it('inviting, changing a role, and removing a member each append exactly one entry naming the acting admin', async () => {
  const created = await tenant('ma-actions', 'Ana Admin')
  const admin = await signIn('ma-actions-admin@example.test')
  const target = await addMember(created.tenantId, 'ma-actions-target@example.test', 'Tara Target', 'driver')

  await inviteMember(admin, { email: 'ma-actions-invitee@example.test', role: 'driver' })
  await changeMemberRole(admin, target, { role: 'dispatcher' })
  // Read while Tara is still a member, so her name resolves.
  const beforeRemoval = await readAuditLog(admin)
  expect(beforeRemoval.entries.map(entry => entry.subjectName)).toEqual(['Tara Target', null])

  await removeTenantMember(admin, target)
  const { entries } = await readAuditLog(admin)
  const byAdmin = { actorUserId: created.adminUserId, actorName: 'Ana Admin' }
  expect(entries).toMatchObject([
    { ...byAdmin, action: 'member.removed', subjectUserId: target, subjectName: null, data: { role: 'dispatcher' } },
    { ...byAdmin, action: 'member.role_changed', subjectUserId: target, subjectName: null, data: { from: 'driver', to: 'dispatcher' } },
    { ...byAdmin, action: 'member.invited', subjectUserId: null, subjectName: null, data: { role: 'driver' } },
  ])
  expect(entries).toHaveLength(3)
  expect(await entryCount(created.tenantId)).toBe(3)
  expect(JSON.stringify(entries)).not.toContain('@example.test')
})

it('a refused invite, role change, or removal appends nothing', async () => {
  const created = await tenant('ma-refused', 'Rita Admin')
  const other = await tenant('ma-refused-other', 'Olga Admin')
  const secondAdmin = await addMember(created.tenantId, 'ma-refused-admin2@example.test', 'Second Admin', 'admin')
  const dispatcher = await addMember(created.tenantId, 'ma-refused-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driver = await addMember(created.tenantId, 'ma-refused-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('ma-refused-admin@example.test')
  const dispatcherHeaders = await signIn('ma-refused-dispatcher@example.test')
  const driverHeaders = await signIn('ma-refused-driver@example.test')
  const invite = { email: 'ma-refused-invitee@example.test', role: 'driver' }

  await expect(inviteMember(dispatcherHeaders, invite)).rejects.toMatchObject({ statusCode: 403 })
  await expect(inviteMember(driverHeaders, invite)).rejects.toMatchObject({ statusCode: 403 })
  await expect(inviteMember(admin, { ...invite, role: 'owner' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(inviteMember(admin, { email: 'ma-refused-dispatcher@example.test', role: 'driver' })).rejects.toMatchObject({ statusCode: 400 })

  await expect(changeMemberRole(dispatcherHeaders, driver, { role: 'dispatcher' })).rejects.toMatchObject({ statusCode: 403 })
  await expect(removeTenantMember(driverHeaders, dispatcher)).rejects.toMatchObject({ statusCode: 403 })
  await expect(changeMemberRole(admin, created.adminUserId, { role: 'driver' })).rejects.toMatchObject({ statusCode: 409 })
  await expect(removeTenantMember(admin, created.adminUserId)).rejects.toMatchObject({ statusCode: 409 })
  await expect(changeMemberRole(admin, crypto.randomUUID(), { role: 'driver' })).rejects.toMatchObject({ statusCode: 404 })
  await expect(removeTenantMember(admin, other.adminUserId)).rejects.toMatchObject({ statusCode: 404 })
  await expect(changeMemberRole(admin, driver, { role: 'owner' })).rejects.toMatchObject({ statusCode: 400 })

  const adminActor: Actor = { context: { tenantId: created.tenantId }, userId: created.adminUserId, role: 'admin' }
  await expect(changeMemberRoleImpl(handle, adminActor, other.tenantId, other.adminUserId, 'driver')).rejects.toMatchObject({ statusCode: 403 })
  await expect(removeMemberImpl(handle, adminActor, other.tenantId, other.adminUserId)).rejects.toMatchObject({ statusCode: 403 })

  // The second admin's actor was read, then a concurrent request demoted them: the lock re-check refuses.
  const stale: Actor = { context: { tenantId: created.tenantId }, userId: secondAdmin, role: 'admin' }
  await authPool.query(`update auth.member set role = 'dispatcher' where organization_id = $1 and user_id = $2`, [created.tenantId, secondAdmin])
  await expect(changeMemberRoleImpl(handle, stale, created.tenantId, driver, 'dispatcher')).rejects.toMatchObject({ statusCode: 403 })
  await expect(removeMemberImpl(handle, stale, created.tenantId, driver)).rejects.toMatchObject({ statusCode: 403 })

  expect(await entryCount(created.tenantId)).toBe(0)
  expect(await entryCount(other.tenantId)).toBe(0)
  expect(await roleIn(created.tenantId, driver)).toBe('driver')
  expect(await roleIn(created.tenantId, dispatcher)).toBe('dispatcher')
})

it('an action whose entry cannot be written does not happen', async () => {
  const created = await tenant('ma-atomic', 'Atena Admin')
  // A role the log cannot show makes the append fail after the member write.
  const target = await addMember(created.tenantId, 'ma-atomic-target@example.test', 'Owen Owner', 'owner')
  await signIn('ma-atomic-target@example.test')
  const admin = await signIn('ma-atomic-admin@example.test')

  await expect(changeMemberRole(admin, target, { role: 'driver' })).rejects.toMatchObject({ statusCode: 500 })
  expect(await roleIn(created.tenantId, target)).toBe('owner')

  await expect(removeTenantMember(admin, target)).rejects.toMatchObject({ statusCode: 500 })
  expect(await roleIn(created.tenantId, target)).toBe('owner')
  const sessions = await authPool.query('select count(*)::int as count from auth.session where user_id = $1', [target])
  expect(sessions.rows[0].count).toBe(1)

  // Better Auth's own insert is covered by the trigger: no entry, no invitation.
  await expect(authPool.query(
    `insert into auth.invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id)
     values ($1, $2, 'ma-atomic-invitee@example.test', 'owner', 'pending', now() + interval '1 day', now(), $3)`,
    [crypto.randomUUID(), created.tenantId, created.adminUserId],
  )).rejects.toMatchObject({ code: '23514' })
  const invitations = await authPool.query('select count(*)::int as count from auth.invitation where organization_id = $1', [created.tenantId])
  expect(invitations.rows[0].count).toBe(0)
  expect(await entryCount(created.tenantId)).toBe(0)
})

it('only an admin reads the audit log, and only their own Tenant\'s entries', async () => {
  const mine = await tenant('ma-read', 'Mara Admin')
  const theirs = await tenant('ma-read-other', 'Teo Admin')
  await addMember(mine.tenantId, 'ma-read-dispatcher@example.test', 'Dina Dispatcher', 'dispatcher')
  await addMember(mine.tenantId, 'ma-read-driver@example.test', 'Dario Driver', 'driver')
  const admin = await signIn('ma-read-admin@example.test')
  const otherAdmin = await signIn('ma-read-other-admin@example.test')

  await inviteMember(admin, { email: 'ma-read-invitee@example.test', role: 'dispatcher' })
  await inviteMember(otherAdmin, { email: 'ma-read-other-invitee@example.test', role: 'driver' })

  const seen = await readAuditLog(admin)
  const seenByOther = await readAuditLog(otherAdmin)
  expect(seen.entries).toMatchObject([{ actorUserId: mine.adminUserId, data: { role: 'dispatcher' } }])
  expect(seenByOther.entries).toMatchObject([{ actorUserId: theirs.adminUserId, data: { role: 'driver' } }])
  expect(seen.entries).toHaveLength(1)
  expect(seenByOther.entries).toHaveLength(1)

  await expect(readAuditLog(await signIn('ma-read-dispatcher@example.test'))).rejects.toMatchObject({ statusCode: 403 })
  await expect(readAuditLog(await signIn('ma-read-driver@example.test'))).rejects.toMatchObject({ statusCode: 403 })
  await expect(readAuditLog(new Headers())).rejects.toMatchObject({ statusCode: 401 })
})
