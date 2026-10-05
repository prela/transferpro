import type { TenantRole } from '../../../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { configureLogger } from '../../../core/index'
import { assertPlatformRole } from '../../../core/infrastructure'
import { closeTenantRuntime, createTenant, handleAuthRequest, readSessionShell, TenantAccessError } from '../../tenancy'
import { createAuth } from '../../tenancy/infrastructure/auth'
import { acceptInvitation, InvitationAccessError } from '../../tenancy/infrastructure/invitation'
import { createSuperadmin, PlatformOperatorError, revokeSuperadmin, setTenantActive } from '../index'

/**
 * The platform role's grants, the exclusion triggers, the emergency lever,
 * and the shorter session. Catalog checks name the privileges and fail
 * when another one appears.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')
configureLogger('info')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const databaseUrl = required('DATABASE_URL')
const platformDatabaseUrl = required('PLATFORM_DATABASE_URL')
const authUrl = required('BETTER_AUTH_URL')
const password = 'platform-role-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const platformPool = new pg.Pool({ connectionString: platformDatabaseUrl })

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'plt-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'plt-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'plt-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'plt-%'
    )`)
    await owner.query(`delete from platform.tenant_account where organization_id in (
      select id from auth.organization where slug like 'plt-%'
    )`)
    await owner.query(`delete from platform.superadmin where user_id in (
      select id from auth."user" where email like 'plt-%@example.test'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (
      select id from auth."user" where email like 'plt-%@example.test'
    )`)
    await auth.query(`delete from auth.member where organization_id in (
      select id from auth.organization where slug like 'plt-%'
    )`)
    await auth.query(`delete from auth."user" where email like 'plt-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'plt-%'`)
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
  await appPool.end()
  await platformPool.end()
})

function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string')
    return error.code
  return undefined
}

/** One transaction. A refusal rolls back, so a missed check writes nothing. Null tenant leaves app.tenant_id unset. */
async function platformAttempt(
  platform: pg.PoolClient,
  tenantId: string | null,
  run: (client: pg.PoolClient) => Promise<unknown>,
): Promise<unknown> {
  try {
    await platform.query('begin')
    if (tenantId !== null)
      await platform.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    await run(platform)
    await platform.query('commit')
    return null
  }
  catch (error) {
    await platform.query('rollback')
    return error
  }
}

async function tenant(slug: string) {
  const adminEmail = `${slug}-admin@example.test`
  const created = await createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail,
    adminName: `Admin ${slug}`,
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  return { ...created, adminEmail }
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

async function sessionLife(email: string): Promise<number> {
  const result = await ownerPool.query<{ life: number }>(
    `select extract(epoch from (session.expires_at - session.created_at))::float as life
     from auth.session as session
     join auth."user" as account on account.id = session.user_id
     where lower(account.email) = $1
     order by session.created_at desc
     limit 1`,
    [email],
  )
  const life = result.rows[0]?.life
  if (life === undefined)
    throw new Error('session row is missing')
  return life
}

it('fails closed on the platform role grants', async () => {
  await assertPlatformRole(platformDatabaseUrl)

  const role = await ownerPool.query<{ rolsuper: boolean, rolbypassrls: boolean }>(
    `select rolsuper, rolbypassrls from pg_roles where rolname = 'transferpro_platform'`,
  )
  expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }])

  const schemas = await ownerPool.query<{ nspname: string }>(`
    select n.nspname
    from pg_namespace n
    where has_schema_privilege('transferpro_platform', n.oid, 'USAGE')
      and n.nspname not like 'pg_%'
      and n.nspname <> 'information_schema'
    order by 1
  `)
  expect(schemas.rows.map(row => row.nspname)).toEqual(['audit', 'auth', 'platform', 'public'])

  const columns = await ownerPool.query<{ grant: string }>(`
    select table_schema || '.' || table_name || '.' || column_name || ' ' || privilege_type as grant
    from information_schema.column_privileges
    where grantee = 'transferpro_platform'
    order by 1
  `)
  expect(columns.rows.map(row => row.grant)).toEqual([
    'auth.organization.created_at SELECT',
    'auth.organization.id SELECT',
    'auth.organization.name SELECT',
    'auth.organization.name UPDATE',
    'auth.organization.slug SELECT',
    'platform.tenant_account.organization_id SELECT',
  ])

  const tables = await ownerPool.query<{ grant: string }>(`
    select table_schema || '.' || table_name || ' ' || privilege_type as grant
    from information_schema.table_privileges
    where grantee = 'transferpro_platform'
    order by 1
  `)
  expect(tables.rows.map(row => row.grant)).toEqual([])

  const routines = await ownerPool.query<{ grant: string }>(`
    select routine_schema || '.' || routine_name || ' ' || privilege_type as grant
    from information_schema.routine_privileges
    where grantee = 'transferpro_platform'
    order by 1
  `)
  expect(routines.rows.map(row => row.grant)).toEqual(['audit.append_tenant_renamed EXECUTE'])

  const deletes = await ownerPool.query<{ n: number }>(`
    select (
      (select count(*) from information_schema.column_privileges
        where grantee = 'transferpro_platform' and privilege_type = 'DELETE')
      + (select count(*) from information_schema.table_privileges
        where grantee = 'transferpro_platform' and privilege_type = 'DELETE')
    )::int as n
  `)
  expect(deletes.rows[0]?.n).toBe(0)

  const appUsage = await ownerPool.query<{ usage: boolean }>(
    `select has_schema_privilege('transferpro_platform', 'app', 'USAGE') as usage`,
  )
  expect(appUsage.rows[0]?.usage).toBe(false)
  const appOnPlatform = await ownerPool.query<{ usage: boolean }>(
    `select has_schema_privilege('transferpro_app', 'platform', 'USAGE') as usage`,
  )
  expect(appOnPlatform.rows[0]?.usage).toBe(false)

  const relations = await ownerPool.query<{ name: string }>(`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'v', 'm', 'p')
    order by 1
  `)
  const names = relations.rows.map(row => row.name)
  for (const requiredName of ['clients', 'drivers', 'vehicles', 'audit_entry', 'tenant_member', 'tenant_settings', 'tenant_invitation'])
    expect(names).toContain(requiredName)

  const platform = await platformPool.connect()
  try {
    for (const name of names) {
      if (!/^[a-z_]+$/.test(name))
        throw new Error(`unexpected app relation name ${name}`)
      const denied = await platform.query(`select * from app.${name} limit 0`).then(() => null, error => error)
      expect(codeOf(denied), name).toBe('42501')
    }
    for (const sql of [
      'select logo from auth.organization',
      'select email from auth."user"',
      'select user_id from auth.member',
      'select email from auth.invitation',
      'update auth.organization set slug = slug where false',
      `insert into auth.organization (id, name, slug, created_at) values ('x', 'x', 'x', now())`,
      'delete from auth.organization where false',
      'delete from platform.tenant_account where false',
      'select suspended_at from platform.tenant_account',
    ]) {
      const denied = await platform.query(sql).then(() => null, error => error)
      expect(codeOf(denied), sql).toBe('42501')
    }
    await platform.query('select id, name, slug, created_at from auth.organization')
    await platform.query('select organization_id from platform.tenant_account')
  }
  finally {
    platform.release()
  }

  const auth = await authPool.connect()
  try {
    await auth.query('select user_id from platform.superadmin')
    const createdAt = await auth.query('select created_at from platform.superadmin').then(() => null, error => error)
    expect(codeOf(createdAt)).toBe('42501')
    const inserted = await auth.query(`insert into platform.superadmin (user_id) values ('missing')`).then(() => null, error => error)
    expect(codeOf(inserted)).toBe('42501')
    const updated = await auth.query('update platform.tenant_account set organization_id = organization_id').then(() => null, error => error)
    expect(codeOf(updated)).toBe('42501')
  }
  finally {
    auth.release()
  }
})

/**
 * A leaked platform URL must not call the generic append. The wrapper has no
 * action or data argument, so the only row it can leave is an empty rename.
 */
it('refuses audit.append_entry for the platform role and appends only an empty tenant.renamed row', async () => {
  const tenantId = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const platform = await platformPool.connect()
  try {
    const forged = await platformAttempt(platform, tenantId, client => client.query(
      `select audit.append_entry('member.removed', $1, $2, '{"role":"driver"}'::jsonb)`,
      [actor, crypto.randomUUID()],
    ))
    expect(codeOf(forged)).toBe('42501')

    const shapedRename = await platformAttempt(platform, tenantId, client => client.query(
      `select audit.append_entry('tenant.renamed', $1, null, '{}'::jsonb)`,
      [actor],
    ))
    expect(codeOf(shapedRename)).toBe('42501')

    const withData = await platformAttempt(platform, tenantId, client => client.query(
      `select audit.append_tenant_renamed($1, 'member.removed', '{"role":"driver"}'::jsonb)`,
      [actor],
    ))
    expect(codeOf(withData)).toBe('42883')

    const unset = await platformAttempt(platform, null, client => client.query(
      'select audit.append_tenant_renamed($1)',
      [actor],
    ))
    expect(codeOf(unset)).toBe('42501')

    const appended = await platformAttempt(platform, tenantId, client => client.query(
      'select audit.append_tenant_renamed($1)',
      [actor],
    ))
    expect(appended).toBeNull()
  }
  finally {
    platform.release()
  }

  const rows = await ownerPool.query<{ action: string, actor_user_id: string, subject_user_id: string | null, data: unknown }>(
    `select action::text as action, actor_user_id, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1
     order by occurred_at`,
    [tenantId],
  )
  expect(rows.rows).toEqual([
    { action: 'tenant.renamed', actor_user_id: actor, subject_user_id: null, data: {} },
  ])
})

it('refuses both directions of a superadmin who is also a member', async () => {
  const created = await tenant('plt-exclude')
  const memberInsert = await ownerPool.query(
    'insert into platform.superadmin (user_id) values ($1)',
    [created.adminUserId],
  ).then(() => null, error => error)
  expect(memberInsert).toBeInstanceOf(Error)
  expect((memberInsert as Error).message).toContain('a tenant member cannot be a superadmin')

  const email = 'plt-owner-exclude@example.test'
  await createSuperadmin({
    name: 'Platform Exclude',
    email,
    password,
    migrateDatabaseUrl,
  })
  const user = await ownerPool.query<{ id: string }>(
    'select id from auth."user" where email = $1',
    [email],
  )
  const userId = user.rows[0]?.id
  expect(userId).toBeTruthy()
  const superadminInsert = await authPool.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, 'admin', now())`,
    [crypto.randomUUID(), created.tenantId, userId],
  ).then(() => null, error => error)
  expect(superadminInsert).toBeInstanceOf(Error)
  expect((superadminInsert as Error).message).toContain('a superadmin cannot be a tenant member')

  const duplicate = await createSuperadmin({
    name: 'Platform Exclude',
    email: created.adminEmail,
    password,
    migrateDatabaseUrl,
  }).then(() => null, error => error)
  expect(duplicate).toBeInstanceOf(PlatformOperatorError)
  expect((duplicate as Error).message).toBe('A platform owner cannot be created for that account.')
  expect((duplicate as Error).message).not.toContain(created.adminEmail)

  await revokeSuperadmin({ email, migrateDatabaseUrl })
  const grant = await ownerPool.query(
    'select user_id from platform.superadmin where user_id = $1',
    [userId],
  )
  expect(grant.rowCount).toBe(0)
  const stillThere = await ownerPool.query('select id from auth."user" where id = $1', [userId])
  expect(stillThere.rowCount).toBe(1)
  const again = await createSuperadmin({
    name: 'Platform Exclude',
    email,
    password,
    migrateDatabaseUrl,
  }).then(() => null, error => error)
  expect(again).toBeInstanceOf(PlatformOperatorError)
  expect((again as Error).message).not.toContain(email)
})

it('keeps a superadmin session shorter than a tenant admin session', async () => {
  const created = await tenant('plt-session')
  await signIn(created.adminEmail)
  const adminLife = await sessionLife(created.adminEmail)
  expect(adminLife).toBeGreaterThan(24 * 60 * 60)

  const email = 'plt-owner-session@example.test'
  await createSuperadmin({
    name: 'Platform Session',
    email,
    password,
    migrateDatabaseUrl,
  })
  const ownerSession = await signIn(email)
  const ownerLife = await sessionLife(email)
  expect(ownerLife).toBeGreaterThan(7.5 * 60 * 60)
  expect(ownerLife).toBeLessThan(8.5 * 60 * 60)

  // A refresh, and a direct write of seven days, both stay inside the cap.
  const refreshed = await handleAuthRequest(new Request(new URL('/api/auth/get-session', authUrl), {
    headers: ownerSession,
  }))
  expect(refreshed.ok).toBe(true)
  await ownerPool.query(
    `update auth.session set expires_at = now() + interval '7 days'
     where user_id = (select id from auth."user" where email = $1)`,
    [email],
  )
  const capped = await sessionLife(email)
  expect(capped).toBeGreaterThan(7.5 * 60 * 60)
  expect(capped).toBeLessThan(8.5 * 60 * 60)

  await ownerPool.query(
    `update auth.session set expires_at = now() + interval '7 days'
     where user_id = $1`,
    [created.adminUserId],
  )
  expect(await sessionLife(created.adminEmail)).toBeGreaterThan(6 * 24 * 60 * 60)
})

it('signing out a superadmin the way the platform page does clears the session cookie', async () => {
  const email = 'plt-owner-signout@example.test'
  await createSuperadmin({
    name: 'Platform Signout',
    email,
    password,
    migrateDatabaseUrl,
  })
  const ownerSession = await signIn(email)
  const cookie = ownerSession.get('cookie')
  if (!cookie)
    throw new Error('sign-in did not set a session cookie')

  const signedOut = await handleAuthRequest(new Request(new URL('/api/auth/sign-out', authUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': authUrl,
      cookie,
    },
    body: JSON.stringify({}),
  }))
  expect(signedOut.status, await signedOut.clone().text()).toBe(200)
  const cleared = signedOut.headers.getSetCookie().find(part => part.includes('session_token'))
  if (!cleared)
    throw new Error('sign-out did not clear the session cookie')
  expect(cleared.toLowerCase()).toContain('max-age=0')

  const leftover = await handleAuthRequest(new Request(new URL('/api/auth/get-session', authUrl), {
    headers: { origin: authUrl, cookie },
  }))
  expect(leftover.status).toBe(200)
  expect(await leftover.json()).toBeNull()
})

it('deactivates the next request and refuses an invitation before a user exists', async () => {
  const slug = 'plt-suspend'
  const created = await tenant(slug)
  await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dispatcher', 'dispatcher')
  await addMember(created.tenantId, `${slug}-driver@example.test`, 'Driver', 'driver')
  const admin = await signIn(created.adminEmail)
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const driver = await signIn(`${slug}-driver@example.test`)
  expect((await readSessionShell(admin)).tenantId).toBe(created.tenantId)
  expect((await readSessionShell(dispatcher)).tenantId).toBe(created.tenantId)
  expect((await readSessionShell(driver)).tenantId).toBe(created.tenantId)

  expect(await setTenantActive({ slug, active: false, migrateDatabaseUrl })).toBe('changed')
  for (const headers of [admin, dispatcher, driver]) {
    const error = await readSessionShell(headers).then(() => null, caught => caught)
    expect(error).toBeInstanceOf(TenantAccessError)
    expect((error as TenantAccessError).statusCode).toBe(403)
  }

  const inviteEmail = `${slug}-invitee@example.test`
  const invitationId = crypto.randomUUID()
  await authPool.query(
    `insert into auth.invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id)
     values ($1, $2, $3, 'dispatcher', 'pending', now() + interval '1 day', now(), $4)`,
    [invitationId, created.tenantId, inviteEmail, created.adminUserId],
  )
  const handle = createAuth({
    AUTH_DATABASE_URL: authDatabaseUrl,
    BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
    BETTER_AUTH_URL: authUrl,
  })
  const refused = await acceptInvitation(handle, {
    invitationId,
    name: 'Invited Person',
    password,
  }, new Headers()).then(() => null, error => error)
  expect(refused).toBeInstanceOf(InvitationAccessError)
  expect((refused as InvitationAccessError).statusCode).toBe(403)
  const users = await ownerPool.query<{ n: number }>(
    'select count(*)::int as n from auth."user" where lower(email) = $1',
    [inviteEmail],
  )
  expect(users.rows[0]?.n).toBe(0)

  expect(await setTenantActive({ slug, active: true, migrateDatabaseUrl })).toBe('changed')
  expect((await readSessionShell(admin)).tenantId).toBe(created.tenantId)
  await acceptInvitation(handle, {
    invitationId,
    name: 'Invited Person',
    password,
  }, new Headers())
  const accepted = await ownerPool.query<{ n: number }>(
    'select count(*)::int as n from auth."user" where lower(email) = $1',
    [inviteEmail],
  )
  expect(accepted.rows[0]?.n).toBe(1)

  expect(await setTenantActive({ slug, active: true, migrateDatabaseUrl })).toBe('unchanged')
  const audit = await ownerPool.query<{ action: string, actor_user_id: string, subject_user_id: string | null, data: unknown }>(
    `select action, actor_user_id, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text in ('tenant.suspended', 'tenant.reactivated')
     order by occurred_at, action`,
    [created.tenantId],
  )
  expect(audit.rows).toEqual([
    { action: 'tenant.suspended', actor_user_id: 'transferpro_owner', subject_user_id: null, data: {} },
    { action: 'tenant.reactivated', actor_user_id: 'transferpro_owner', subject_user_id: null, data: {} },
  ])
})
