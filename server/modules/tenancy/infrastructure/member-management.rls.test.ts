import type { AuthHandle } from './auth'
import type { Actor } from './session'
import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { changeMemberRole, closeTenantRuntime, handleAuthRequest, listMembers, removeTenantMember } from '..'
import { createAuth } from './auth'
import { createTenant } from './create-tenant'
import { insertCredentialMember, insertMembership } from './credential-member'
import { assertAnotherAdmin, changeMemberRole as changeMemberRoleImpl, removeMember as removeMemberImpl } from './member-management'

/**
 * Member management RLS tests: listing, changing roles, and removing members.
 * Calls go through the module's session functions, so the actor is resolved
 * from a real cookie by the same runtime the routes use. That runtime reads
 * BETTER_AUTH_SECRET from .env, so the test handle signs in with it too.
 * Unique emails per test to avoid cross-test pollution.
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
const baseUrl = required('BETTER_AUTH_URL')

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const handle: AuthHandle = createAuth({
  AUTH_DATABASE_URL: authDatabaseUrl,
  BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
  BETTER_AUTH_URL: baseUrl,
})

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
  await closeTenantRuntime()
  await handle.close()
  await authPool.end()
})

/** A fresh session. Better Auth leaves its active organization unset. */
async function signIn(email: string, password: string): Promise<Headers> {
  const signedIn = await handle.auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  const cookie = signedIn.headers.getSetCookie().map(part => part.split(';')[0]).join('; ')
  return new Headers({ cookie })
}

async function setActiveTenant(headers: Headers, tenantId: string): Promise<void> {
  await handle.auth.api.setActiveOrganization({ headers, body: { organizationId: tenantId } })
}

async function roleIn(tenantId: string, userId: string): Promise<string | undefined> {
  const memberships = await handle.memberships(userId)
  return memberships.find(m => m.organizationId === tenantId)?.role
}

async function inAuthTransaction(run: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await authPool.connect()
  try {
    await client.query('begin')
    await run(client)
  }
  finally {
    await client.query('rollback')
    client.release()
  }
}

it('admin of tenant A targeting a member of tenant B gets 404, naming tenant B gets 403, and nothing changes', async () => {
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

  try {
    const headersA = await signIn('mm-admin-a@example.test', 'password-a')

    // Admin A's session is tenant A, so Admin B is not a member there: 404.
    await expect(
      changeMemberRole(headersA, tenantB.adminUserId, { role: 'dispatcher' }),
    ).rejects.toThrow('Member not found')
    await expect(
      removeTenantMember(headersA, tenantB.adminUserId),
    ).rejects.toMatchObject({ statusCode: 404 })

    // An admin actor of tenant A that names tenant B is refused before the lock.
    const actorA: Actor = { context: { tenantId: tenantA.tenantId }, userId: tenantA.adminUserId, role: 'admin' }
    await expect(
      changeMemberRoleImpl(handle, actorA, tenantB.tenantId, tenantB.adminUserId, 'dispatcher'),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      removeMemberImpl(handle, actorA, tenantB.tenantId, tenantB.adminUserId),
    ).rejects.toMatchObject({ statusCode: 403 })

    // Verify Admin B's role is still admin
    expect(await roleIn(tenantB.tenantId, tenantB.adminUserId)).toBe('admin')
  }
  finally {
    await closeTenantRuntime()
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
  await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-dispatcher@example.test', name: 'Dispatcher', password: 'password-dispatcher', role: 'dispatcher' })
  await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-driver@example.test', name: 'Driver', password: 'password-driver', role: 'driver' })

  try {
    // Dispatcher tries to change admin's role - should get 403
    const headersDisp = await signIn('mm-dispatcher@example.test', 'password-dispatcher')
    await expect(
      changeMemberRole(headersDisp, tenant.adminUserId, { role: 'driver' }),
    ).rejects.toThrow('Forbidden')
    await expect(
      removeTenantMember(headersDisp, tenant.adminUserId),
    ).rejects.toThrow('Forbidden')

    // Driver tries to change admin's role - should get 403
    const headersDriver = await signIn('mm-driver@example.test', 'password-driver')
    await expect(
      changeMemberRole(headersDriver, tenant.adminUserId, { role: 'dispatcher' }),
    ).rejects.toThrow('Forbidden')
    await expect(
      removeTenantMember(headersDriver, tenant.adminUserId),
    ).rejects.toThrow('Forbidden')

    expect(await roleIn(tenant.tenantId, tenant.adminUserId)).toBe('admin')
  }
  finally {
    await closeTenantRuntime()
  }
})

it('the last admin is refused by the admin recount (409), and only another admin can act', async () => {
  const tenant = await createTenant({
    name: 'Tenant Last Admin',
    slug: 'mm-tenant-last-admin',
    adminEmail: 'mm-last-admin@example.test',
    adminName: 'Last Admin',
    password: 'password-last',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  // Create a second admin so we can have one admin try to demote the other
  const admin2UserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-admin2-last@example.test', name: 'Admin 2', password: 'password-admin2', role: 'admin' })

  try {
    const headers = await signIn('mm-admin2-last@example.test', 'password-admin2')

    // Remove the first admin so second admin is the last one
    await removeTenantMember(headers, tenant.adminUserId)
    expect(await roleIn(tenant.tenantId, tenant.adminUserId)).toBeUndefined()

    // changeMemberRole and removeMember re-read the caller as an admin under
    // the lock, and the caller is never the target, so their recount always
    // finds the caller. The recount itself is what refuses the last admin.
    await inAuthTransaction(async (client) => {
      await expect(
        assertAnotherAdmin(client, tenant.tenantId, admin2UserId),
      ).rejects.toMatchObject({ statusCode: 409, message: 'Cannot remove or demote the last admin.' })
    })

    // Admin 2 tries to demote or remove themselves as last admin - the self check answers 409 first
    await expect(
      changeMemberRole(headers, admin2UserId, { role: 'dispatcher' }),
    ).rejects.toThrow('Cannot change your own role')
    await expect(
      removeTenantMember(headers, admin2UserId),
    ).rejects.toThrow('Cannot remove yourself')
    expect(await roleIn(tenant.tenantId, admin2UserId)).toBe('admin')

    // Now create a third admin so admin2 is not the last
    const admin3UserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-admin3-last@example.test', name: 'Admin 3', password: 'password-admin3', role: 'admin' })
    await inAuthTransaction(async (client) => {
      await expect(assertAnotherAdmin(client, tenant.tenantId, admin2UserId)).resolves.toBeUndefined()
    })

    // Admin 2 demotes Admin 3 (admin 2 stays) - should succeed
    await changeMemberRole(headers, admin3UserId, { role: 'dispatcher' })
    expect(await roleIn(tenant.tenantId, admin3UserId)).toBe('dispatcher')

    // Admin 2 is now the last admin. Sign in as admin 3 (now dispatcher)
    const headers3 = await signIn('mm-admin3-last@example.test', 'password-admin3')

    // Dispatcher tries to change last admin - gets 403 (not admin)
    await expect(
      changeMemberRole(headers3, admin2UserId, { role: 'dispatcher' }),
    ).rejects.toThrow('Forbidden')
    expect(await roleIn(tenant.tenantId, admin2UserId)).toBe('admin')
  }
  finally {
    await closeTenantRuntime()
  }
})

it('removal deletes the member\'s sessions for this Tenant and with no Tenant, keeps another Tenant\'s, and a tenant call is then 401', async () => {
  const tenant = await createTenant({
    name: 'Tenant Session Revoke',
    slug: 'mm-tenant-revoke',
    adminEmail: 'mm-admin-revoke@example.test',
    adminName: 'Admin Revoke',
    password: 'password-revoke',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const other = await createTenant({
    name: 'Tenant Session Keep',
    slug: 'mm-tenant-revoke-other',
    adminEmail: 'mm-admin-revoke-other@example.test',
    adminName: 'Admin Other',
    password: 'password-other',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const dispatcherUserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-disp-revoke@example.test', name: 'Dispatcher Rev', password: 'password-disp', role: 'dispatcher' })
  await insertMembership(authPool, other.tenantId, dispatcherUserId, 'dispatcher')

  try {
    // Three sessions: no active organization, this Tenant, and the other Tenant.
    const unset = await signIn('mm-disp-revoke@example.test', 'password-disp')
    const active = await signIn('mm-disp-revoke@example.test', 'password-disp')
    await setActiveTenant(active, tenant.tenantId)
    const elsewhere = await signIn('mm-disp-revoke@example.test', 'password-disp')
    await setActiveTenant(elsewhere, other.tenantId)

    // Verify dispatcher can access tenant before removal
    await expect(listMembers(active)).resolves.toMatchObject({
      members: expect.arrayContaining([{ userId: dispatcherUserId, name: 'Dispatcher Rev', role: 'dispatcher' }]),
    })

    // Admin removes the dispatcher
    const headersAdmin = await signIn('mm-admin-revoke@example.test', 'password-revoke')
    await removeTenantMember(headersAdmin, dispatcherUserId)

    // Verify dispatcher's sessions for this Tenant and for no Tenant are gone
    expect(await handle.auth.api.getSession({ headers: unset })).toBeNull()
    expect(await handle.auth.api.getSession({ headers: active })).toBeNull()
    await expect(listMembers(active)).rejects.toMatchObject({ statusCode: 401 })

    // The session in the other Tenant is not this Tenant's to revoke
    expect(await handle.auth.api.getSession({ headers: elsewhere })).toMatchObject({ user: { id: dispatcherUserId } })

    // Verify dispatcher's membership is gone here and kept in the other Tenant
    expect(await roleIn(tenant.tenantId, dispatcherUserId)).toBeUndefined()
    expect(await roleIn(other.tenantId, dispatcherUserId)).toBe('dispatcher')
  }
  finally {
    await closeTenantRuntime()
  }
})

it('concurrent role changes with advisory lock ensure at least one admin remains', async () => {
  const tenant = await createTenant({
    name: 'Tenant Concurrent',
    slug: 'mm-tenant-concurrent',
    adminEmail: 'mm-admin1-concurrent@example.test',
    adminName: 'Admin 1',
    password: 'password-admin1',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  // Create a second admin
  const admin2UserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-admin2-concurrent@example.test', name: 'Admin 2', password: 'password-admin2', role: 'admin' })

  try {
    // Sign in as both admins
    const headers1 = await signIn('mm-admin1-concurrent@example.test', 'password-admin1')
    const headers2 = await signIn('mm-admin2-concurrent@example.test', 'password-admin2')

    const results = await Promise.allSettled([
      changeMemberRole(headers1, admin2UserId, { role: 'dispatcher' }),
      changeMemberRole(headers2, tenant.adminUserId, { role: 'dispatcher' }),
    ])

    // The loser re-reads its own role under the lock and finds itself demoted.
    const succeeded = results.filter(r => r.status === 'fulfilled')
    const failed = results.filter(r => r.status === 'rejected')

    expect(succeeded.length).toBe(1)
    expect(failed.length).toBe(1)
    expect(failed[0]?.reason).toMatchObject({ statusCode: 403, message: 'Forbidden' })

    // Verify exactly one admin remains
    const membersResult = await authPool.query(
      `select count(*) as admin_count from auth.member
       where organization_id = $1 and role = 'admin'`,
      [tenant.tenantId],
    )
    const adminCount = Number.parseInt(membersResult.rows[0].admin_count as string, 10)
    expect(adminCount).toBe(1)
  }
  finally {
    await closeTenantRuntime()
  }
})

it('admin cannot change their own role or remove themselves (self-protection)', async () => {
  const tenant = await createTenant({
    name: 'Tenant Self Protect',
    slug: 'mm-tenant-self',
    adminEmail: 'mm-admin-self@example.test',
    adminName: 'Admin Self',
    password: 'password-self',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  // Create a second admin so we're not testing last-admin protection
  await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-admin2-self@example.test', name: 'Admin 2', password: 'password-admin2', role: 'admin' })

  try {
    // Sign in as first admin
    const headers = await signIn('mm-admin-self@example.test', 'password-self')

    // Admin tries to change their own role - should get 409
    await expect(
      changeMemberRole(headers, tenant.adminUserId, { role: 'dispatcher' }),
    ).rejects.toThrow('your own role')

    // Admin tries to remove themselves - should get 409
    await expect(
      removeTenantMember(headers, tenant.adminUserId),
    ).rejects.toThrow('yourself')

    expect(await roleIn(tenant.tenantId, tenant.adminUserId)).toBe('admin')
  }
  finally {
    await closeTenantRuntime()
  }
})

it('a driver gets 403 from listMembers and a dispatcher of the same Tenant gets the members', async () => {
  const tenant = await createTenant({
    name: 'Tenant Driver List',
    slug: 'mm-tenant-driver-list',
    adminEmail: 'mm-admin-driver-list@example.test',
    adminName: 'Admin',
    password: 'password-admin',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const driverUserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-driver-list@example.test', name: 'Driver', password: 'password-driver', role: 'driver' })
  const dispatcherUserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-dispatcher-list@example.test', name: 'Dispatcher', password: 'password-dispatcher', role: 'dispatcher' })

  try {
    const driverHeaders = await signIn('mm-driver-list@example.test', 'password-driver')
    const dispatcherHeaders = await signIn('mm-dispatcher-list@example.test', 'password-dispatcher')

    await expect(listMembers(driverHeaders)).rejects.toMatchObject({ statusCode: 403 })
    await expect(listMembers(dispatcherHeaders)).resolves.toEqual({
      members: [
        { userId: tenant.adminUserId, name: 'Admin', role: 'admin' },
        { userId: dispatcherUserId, name: 'Dispatcher', role: 'dispatcher' },
        { userId: driverUserId, name: 'Driver', role: 'driver' },
      ],
    })
  }
  finally {
    await closeTenantRuntime()
  }
})

it('a driver in tenant A who is a dispatcher in tenant B gets 403 from listMembers while A is active', async () => {
  const tenantA = await createTenant({
    name: 'Tenant Role A',
    slug: 'mm-tenant-role-a',
    adminEmail: 'mm-admin-role-a@example.test',
    adminName: 'Admin A',
    password: 'password-a',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const tenantB = await createTenant({
    name: 'Tenant Role B',
    slug: 'mm-tenant-role-b',
    adminEmail: 'mm-admin-role-b@example.test',
    adminName: 'Admin B',
    password: 'password-b',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const userId = await insertCredentialMember(authPool, tenantA.tenantId, { email: 'mm-two-roles@example.test', name: 'Two Roles', password: 'password-two', role: 'driver' })
  await insertMembership(authPool, tenantB.tenantId, userId, 'dispatcher')

  try {
    const headers = await signIn('mm-two-roles@example.test', 'password-two')
    await setActiveTenant(headers, tenantA.tenantId)
    await expect(listMembers(headers)).rejects.toMatchObject({ statusCode: 403 })

    // The same session with tenant B active is a dispatcher there, and sees only B.
    await setActiveTenant(headers, tenantB.tenantId)
    await expect(listMembers(headers)).resolves.toEqual({
      members: [
        { userId: tenantB.adminUserId, name: 'Admin B', role: 'admin' },
        { userId, name: 'Two Roles', role: 'dispatcher' },
      ],
    })
  }
  finally {
    await closeTenantRuntime()
  }
})

it('an admin demoted after their actor was read gets 403 under the lock and nothing changes', async () => {
  const tenant = await createTenant({
    name: 'Tenant Stale Admin',
    slug: 'mm-tenant-stale',
    adminEmail: 'mm-admin1-stale@example.test',
    adminName: 'Admin 1',
    password: 'password-admin1',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const admin2UserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-admin2-stale@example.test', name: 'Admin 2', password: 'password-admin2', role: 'admin' })
  const dispatcherUserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-disp-stale@example.test', name: 'Dispatcher', password: 'password-disp', role: 'dispatcher' })

  try {
    // Admin 2's actor as the session read it, before Admin 1 demotes them.
    const stale: Actor = { context: { tenantId: tenant.tenantId }, userId: admin2UserId, role: 'admin' }
    const headers1 = await signIn('mm-admin1-stale@example.test', 'password-admin1')
    await changeMemberRole(headers1, admin2UserId, { role: 'dispatcher' })

    await expect(
      changeMemberRoleImpl(handle, stale, tenant.tenantId, dispatcherUserId, 'driver'),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      removeMemberImpl(handle, stale, tenant.tenantId, dispatcherUserId),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(await roleIn(tenant.tenantId, dispatcherUserId)).toBe('dispatcher')
  }
  finally {
    await closeTenantRuntime()
  }
})

it('better Auth\'s own member routes under /api/auth are off, so the lock, the checks above, and the driver 403 cannot be skipped', async () => {
  const tenant = await createTenant({
    name: 'Tenant Auth Endpoints',
    slug: 'mm-tenant-auth-endpoints',
    adminEmail: 'mm-admin-endpoints@example.test',
    adminName: 'Admin',
    password: 'password-admin',
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  // A second admin, so Better Auth's own "last owner" rule does not answer first.
  const admin2UserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-admin2-endpoints@example.test', name: 'Admin 2', password: 'password-admin2', role: 'admin' })
  const driverUserId = await insertCredentialMember(authPool, tenant.tenantId, { email: 'mm-driver-endpoints@example.test', name: 'Driver', password: 'password-driver', role: 'driver' })
  const memberIds = await authPool.query<{ id: string, user_id: string }>(
    'select id, user_id from auth.member where organization_id = $1',
    [tenant.tenantId],
  )
  const memberId = (userId: string) => memberIds.rows.find(row => row.user_id === userId)?.id

  function call(headers: Headers, path: string, body?: unknown): Promise<Response> {
    const url = new URL(`/api/auth/organization/${path}`, baseUrl)
    if (body === undefined)
      url.searchParams.set('organizationId', tenant.tenantId)
    return handleAuthRequest(new Request(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'origin': baseUrl, 'cookie': headers.get('cookie') ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  }

  try {
    const adminHeaders = await signIn('mm-admin-endpoints@example.test', 'password-admin')
    const driverHeaders = await signIn('mm-driver-endpoints@example.test', 'password-driver')
    const statuses = {
      demoteOther: (await call(adminHeaders, 'update-member-role', { memberId: memberId(driverUserId), role: 'dispatcher', organizationId: tenant.tenantId })).status,
      demoteSelf: (await call(adminHeaders, 'update-member-role', { memberId: memberId(tenant.adminUserId), role: 'driver', organizationId: tenant.tenantId })).status,
      remove: (await call(adminHeaders, 'remove-member', { memberIdOrEmail: memberId(driverUserId), organizationId: tenant.tenantId })).status,
      leave: (await call(adminHeaders, 'leave', { organizationId: tenant.tenantId })).status,
      driverListMembers: (await call(driverHeaders, 'list-members')).status,
      driverFullOrganization: (await call(driverHeaders, 'get-full-organization')).status,
      driverListInvitations: (await call(driverHeaders, 'list-invitations')).status,
    }

    expect(statuses).toEqual({
      demoteOther: 404,
      demoteSelf: 404,
      remove: 404,
      leave: 404,
      driverListMembers: 404,
      driverFullOrganization: 404,
      driverListInvitations: 404,
    })
    expect(await roleIn(tenant.tenantId, tenant.adminUserId)).toBe('admin')
    expect(await roleIn(tenant.tenantId, admin2UserId)).toBe('admin')
    expect(await roleIn(tenant.tenantId, driverUserId)).toBe('driver')
  }
  finally {
    await closeTenantRuntime()
  }
})
