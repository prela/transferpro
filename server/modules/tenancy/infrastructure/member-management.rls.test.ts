import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createAuth } from './auth'
import { createTenant } from './create-tenant'

/**
 * Member management RLS tests: changing roles and removing members across tenants.
 * Uses real functions (changeMemberRole, removeMember) through auth handle, not raw SQL.
 * Unique emails per test to avoid cross-test pollution.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

const databaseUrl = process.env.DATABASE_URL
const authDatabaseUrl = process.env.AUTH_DATABASE_URL
const migrateDatabaseUrl = process.env.DATABASE_MIGRATE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')
if (!authDatabaseUrl)
  throw new Error('AUTH_DATABASE_URL is required (the transferpro_auth role)')
if (!migrateDatabaseUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })

beforeAll(async () => {
  const auth = await authPool.connect()
  try {
    await auth.query('begin')
    // Clean up by email pattern
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'mm-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'mm-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'mm-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'mm-%'`)
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
  await authPool.end()
})

it('admin of tenant A targeting a member of tenant B gets 404 and nothing changes', async () => {
  // Create two tenants with admins
  const tenantA = await createTenant({
    name: 'Tenant A MM',
    slug: 'mm-tenant-a',
    adminEmail: 'mm-admin-a@example.test',
    adminName: 'Admin A',
    password: 'password-a',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })

  const tenantB = await createTenant({
    name: 'Tenant B MM',
    slug: 'mm-tenant-b',
    adminEmail: 'mm-admin-b@example.test',
    adminName: 'Admin B',
    password: 'password-b',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })

  const handle = createAuth({ AUTH_DATABASE_URL: authDatabaseUrl, BETTER_AUTH_SECRET: 'test-secret', BETTER_AUTH_URL: 'http://localhost:3000' })

  try {
    // Sign in as admin A
    const signInA = await handle.auth.api.signInEmail({
      body: { email: 'mm-admin-a@example.test', password: 'password-a' },
      returnHeaders: true,
    })
    const cookieA = signInA.headers.getSetCookie().join('; ')
    const headersA = new Headers({ cookie: cookieA })

    // Admin A tries to change Admin B's role - should get 404 (member not in their org)
    const { changeMemberRole } = await import('./member-management')
    await expect(
      changeMemberRole(handle, headersA, tenantA.tenantId, tenantB.adminUserId, 'dispatcher'),
    ).rejects.toThrow('Member not found')

    // Verify Admin B's role is still admin
    const membershipsB = await handle.memberships(tenantB.adminUserId)
    const membershipB = membershipsB.find(m => m.organizationId === tenantB.tenantId)
    expect(membershipB?.role).toBe('admin')
  }
  finally {
    await handle.close()
  }
})

it('dispatcher and driver get 403 when trying to change roles or remove members', async () => {
  const tenant = await createTenant({
    name: 'Tenant Dispatcher Test',
    slug: 'mm-tenant-dispatcher',
    adminEmail: 'mm-admin-disp@example.test',
    adminName: 'Admin',
    password: 'password-admin',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })

  const handle = createAuth({ AUTH_DATABASE_URL: authDatabaseUrl, BETTER_AUTH_SECRET: 'test-secret', BETTER_AUTH_URL: 'http://localhost:3000' })

  try {
    // Create a dispatcher account with properly hashed password
    const dispatcherUserId = crypto.randomUUID()
    const { hashPassword } = await import('better-auth/crypto')
    const hashedPassword = await hashPassword('password-dispatcher')

    await authPool.query(
      `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Dispatcher', 'mm-dispatcher@example.test', true, now(), now())`,
      [dispatcherUserId],
    )
    await authPool.query(
      `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $2, $3, now(), now())`,
      [crypto.randomUUID(), dispatcherUserId, hashedPassword],
    )
    await authPool.query(
      `insert into auth.member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, 'dispatcher', now())`,
      [crypto.randomUUID(), tenant.tenantId, dispatcherUserId],
    )

    // Sign in as dispatcher
    const signIn = await handle.auth.api.signInEmail({
      body: { email: 'mm-dispatcher@example.test', password: 'password-dispatcher' },
      returnHeaders: true,
    })
    const cookie = signIn.headers.getSetCookie().join('; ')
    const headers = new Headers({ cookie })

    // Dispatcher tries to change admin's role - should get 403
    const { changeMemberRole } = await import('./member-management')
    await expect(
      changeMemberRole(handle, headers, tenant.tenantId, tenant.adminUserId, 'driver'),
    ).rejects.toThrow('Forbidden')

    // Dispatcher tries to remove admin - should get 403
    const { removeMember } = await import('./member-management')
    await expect(
      removeMember(handle, headers, tenant.tenantId, tenant.adminUserId),
    ).rejects.toThrow('Forbidden')
  }
  finally {
    await handle.close()
  }
})

it('last admin gets 409 and cannot be removed or demoted', async () => {
  const tenant = await createTenant({
    name: 'Tenant Last Admin',
    slug: 'mm-tenant-last-admin',
    adminEmail: 'mm-last-admin@example.test',
    adminName: 'Last Admin',
    password: 'password-last',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })

  const handle = createAuth({ AUTH_DATABASE_URL: authDatabaseUrl, BETTER_AUTH_SECRET: 'test-secret', BETTER_AUTH_URL: 'http://localhost:3000' })

  try {
    // Sign in as the admin
    const signIn = await handle.auth.api.signInEmail({
      body: { email: 'mm-last-admin@example.test', password: 'password-last' },
      returnHeaders: true,
    })
    const cookie = signIn.headers.getSetCookie().join('; ')
    const headers = new Headers({ cookie })

    // Admin tries to demote themselves - should get 409
    const { changeMemberRole } = await import('./member-management')
    await expect(
      changeMemberRole(handle, headers, tenant.tenantId, tenant.adminUserId, 'dispatcher'),
    ).rejects.toThrow('Cannot remove or demote the last admin')

    // Admin tries to remove themselves - should get 409
    const { removeMember } = await import('./member-management')
    await expect(
      removeMember(handle, headers, tenant.tenantId, tenant.adminUserId),
    ).rejects.toThrow('Cannot remove or demote the last admin')
  }
  finally {
    await handle.close()
  }
})

it('after removal the user\'s NULL-org session is gone and a tenant call returns 403', async () => {
  const tenant = await createTenant({
    name: 'Tenant Session Revoke',
    slug: 'mm-tenant-revoke',
    adminEmail: 'mm-admin-revoke@example.test',
    adminName: 'Admin Revoke',
    password: 'password-revoke',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })

  const handle = createAuth({ AUTH_DATABASE_URL: authDatabaseUrl, BETTER_AUTH_SECRET: 'test-secret', BETTER_AUTH_URL: 'http://localhost:3000' })

  try {
    // Create a dispatcher account
    const dispatcherUserId = crypto.randomUUID()
    const dispatcherPassword = await (await import('better-auth/crypto')).hashPassword('password-disp')
    await authPool.query(
      `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Dispatcher Rev', 'mm-disp-revoke@example.test', true, now(), now())`,
      [dispatcherUserId],
    )
    await authPool.query(
      `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $2, $3, now(), now())`,
      [crypto.randomUUID(), dispatcherUserId, dispatcherPassword],
    )
    await authPool.query(
      `insert into auth.member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, 'dispatcher', now())`,
      [crypto.randomUUID(), tenant.tenantId, dispatcherUserId],
    )

    // Sign in as dispatcher (creates a session with active_organization_id = NULL)
    const signInDisp = await handle.auth.api.signInEmail({
      body: { email: 'mm-disp-revoke@example.test', password: 'password-disp' },
      returnHeaders: true,
    })
    const cookieDisp = signInDisp.headers.getSetCookie().join('; ')
    const headersDisp = new Headers({ cookie: cookieDisp })

    // Verify dispatcher can access tenant before removal
    const sessionBefore = await handle.auth.api.getSession({ headers: headersDisp })
    expect(sessionBefore).toBeTruthy()
    expect(sessionBefore?.user.id).toBe(dispatcherUserId)

    // Sign in as admin
    const signInAdmin = await handle.auth.api.signInEmail({
      body: { email: 'mm-admin-revoke@example.test', password: 'password-revoke' },
      returnHeaders: true,
    })
    const cookieAdmin = signInAdmin.headers.getSetCookie().join('; ')
    const headersAdmin = new Headers({ cookie: cookieAdmin })

    // Admin removes the dispatcher
    const { removeMember } = await import('./member-management')
    await removeMember(handle, headersAdmin, tenant.tenantId, dispatcherUserId)

    // Verify dispatcher's session is gone
    const sessionAfter = await handle.auth.api.getSession({ headers: headersDisp })
    expect(sessionAfter).toBeNull()

    // Verify dispatcher's membership is gone
    const membershipsAfter = await handle.memberships(dispatcherUserId)
    const membershipAfter = membershipsAfter.find(m => m.organizationId === tenant.tenantId)
    expect(membershipAfter).toBeUndefined()
  }
  finally {
    await handle.close()
  }
})
