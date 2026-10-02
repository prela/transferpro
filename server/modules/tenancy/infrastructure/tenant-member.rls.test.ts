import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { parseAppEnv } from '../../../core/index'
import { createAuth } from './auth'

/**
 * Member seam: the app role reads app.tenant_member, not auth.user.
 * The rows are the observation. Policy text and grants are not.
 */
const databaseUrl = process.env.DATABASE_URL
const authDatabaseUrl = process.env.AUTH_DATABASE_URL
const queueDatabaseUrl = process.env.QUEUE_DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')
if (!authDatabaseUrl)
  throw new Error('AUTH_DATABASE_URL is required (the transferpro_auth role)')
if (!queueDatabaseUrl)
  throw new Error('QUEUE_DATABASE_URL is required (the transferpro_queue role)')

const env = parseAppEnv({
  DATABASE_URL: databaseUrl,
  AUTH_DATABASE_URL: authDatabaseUrl,
  QUEUE_DATABASE_URL: queueDatabaseUrl,
  BETTER_AUTH_SECRET: 'transferpro-test-secret-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
})

const appPool = new pg.Pool({ connectionString: databaseUrl })
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const emailA = 'ana@example.com'
const emailB = 'boris@example.com'

beforeAll(async () => {
  const auth = await authPool.connect()
  try {
    await auth.query('begin')
    await auth.query('delete from auth.member where user_id = any($1::text[])', [[userA, userB]])
    await auth.query('delete from auth.organization where id = any($1::text[])', [[tenantA, tenantB]])
    await auth.query('delete from auth."user" where id = any($1::text[])', [[userA, userB]])
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
  await appPool.end()
  await authPool.end()
})

async function withApp<T>(
  tenantId: string | null,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('begin')
    if (tenantId !== null)
      await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantId])
    const result = await run(client)
    await client.query('commit')
    return result
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}

it('a tenant session sees only that organization\'s members, and not their email', async () => {
  const auth = await authPool.connect()
  try {
    await auth.query('begin')
    await auth.query(
      `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Ana', $2, true, now(), now()),
              ($3, 'Boris', $4, true, now(), now())`,
      [userA, emailA, userB, emailB],
    )
    await auth.query(
      `insert into auth.organization (id, name, slug, created_at)
       values ($1, 'Tenant A', 'tenant-a', now()),
              ($2, 'Tenant B', 'tenant-b', now())`,
      [tenantA, tenantB],
    )
    await auth.query(
      `insert into auth.member (id, organization_id, user_id, role, created_at)
       values ('member-a', $1, $2, 'driver', now()),
              ('member-b', $3, $4, 'admin', now())`,
      [tenantA, userA, tenantB, userB],
    )
    await auth.query('commit')
  }
  catch (error) {
    await auth.query('rollback')
    throw error
  }
  finally {
    auth.release()
  }

  const seenByA = await withApp(tenantA, async (client) => {
    const selected = await client.query('select user_id, name, role from app.tenant_member')
    return selected.rows
  })
  const seenByB = await withApp(tenantB, async (client) => {
    const selected = await client.query('select user_id, name, role from app.tenant_member')
    return selected.rows
  })
  const seenByNobody = await withApp(null, async (client) => {
    const selected = await client.query('select user_id, name, role from app.tenant_member')
    return selected.rows
  })

  expect(seenByA).toEqual([{ user_id: userA, name: 'Ana', role: 'driver' }])
  expect(seenByB).toEqual([{ user_id: userB, name: 'Boris', role: 'admin' }])
  expect(seenByNobody).toEqual([])
  expect(JSON.stringify(seenByA)).not.toContain(emailA)

  await expect(withApp(tenantA, client =>
    client.query('select email from app.tenant_member'))).rejects.toThrow(/email/)

  // A join view is not deletable. The grant check below is what keeps it that way.
  await expect(withApp(tenantA, client =>
    client.query('delete from app.tenant_member'))).rejects.toThrow(/cannot delete from view/)

  const stillAna = await withApp(tenantA, async (client) => {
    const selected = await client.query('select user_id, name, role from app.tenant_member')
    return selected.rows
  })
  expect(stillAna).toEqual([{ user_id: userA, name: 'Ana', role: 'driver' }])

  await expect(withApp(tenantA, client =>
    client.query('select email from auth."user"'))).rejects.toThrow(/permission denied/)
})

it('creating an organization makes that admin visible to the tenant session', async () => {
  const authClient = await authPool.connect()
  try {
    await authClient.query('begin')
    await authClient.query(
      `delete from auth.member where user_id in (select id from auth."user" where email = 'cora@example.com')`,
    )
    await authClient.query(
      `delete from auth.session where user_id in (select id from auth."user" where email = 'cora@example.com')`,
    )
    await authClient.query(
      `delete from auth.account where user_id in (select id from auth."user" where email = 'cora@example.com')`,
    )
    await authClient.query(`delete from auth.organization where slug = 'tenant-cora'`)
    await authClient.query(`delete from auth."user" where email = 'cora@example.com'`)
    await authClient.query('commit')
  }
  catch (error) {
    await authClient.query('rollback')
    throw error
  }
  finally {
    authClient.release()
  }

  const { auth, close } = createAuth(env)
  try {
    const signedUp = await auth.api.signUpEmail({
      body: {
        name: 'Cora',
        email: 'cora@example.com',
        password: 'super-secret-password',
      },
      returnHeaders: true,
    })
    // The sign-up response sets the session cookie. The next call has to send it back.
    const cookie = signedUp.headers.getSetCookie().map(part => part.split(';')[0]).join('; ')
    const created = await auth.api.createOrganization({
      body: { name: 'Tenant Cora', slug: 'tenant-cora' },
      headers: { cookie },
    })

    const seen = await withApp(created.id, async (client) => {
      const selected = await client.query('select user_id, name, role from app.tenant_member')
      return selected.rows
    })

    expect(seen).toEqual([{ user_id: signedUp.response.user.id, name: 'Cora', role: 'admin' }])
    expect(JSON.stringify(seen)).not.toContain('cora@example.com')
  }
  finally {
    await close()
  }
})

it('better Auth tables are not tenant tables, and every app table is', async () => {
  const client = await appPool.connect()
  try {
    const authTables = await client.query<{
      relname: string
      relrowsecurity: boolean
      app_select: boolean
    }>(
      `select c.relname,
              c.relrowsecurity,
              has_table_privilege('transferpro_app', c.oid, 'SELECT') as app_select
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'auth' and c.relkind = 'r'`,
    )
    const names = authTables.rows.map(row => row.relname)
    expect(names).toEqual(expect.arrayContaining(['user', 'organization', 'member']))
    expect(authTables.rows.every(row => !row.relrowsecurity && !row.app_select)).toBe(true)

    const appTables = await client.query<{ relname: string }>(
      `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app'
         and c.relkind = 'r'
         and (
           not c.relrowsecurity
           or not c.relforcerowsecurity
           or not exists (
             select 1
             from information_schema.columns col
             where col.table_schema = 'app'
               and col.table_name = c.relname
               and col.column_name = 'tenant_id'
           )
         )`,
    )
    expect(appTables.rows).toEqual([])

    const view = await client.query<{
      can_select: boolean
      can_insert: boolean
      can_update: boolean
      can_delete: boolean
    }>(
      `select has_table_privilege('transferpro_app', 'app.tenant_member'::regclass, 'SELECT') as can_select,
              has_table_privilege('transferpro_app', 'app.tenant_member'::regclass, 'INSERT') as can_insert,
              has_table_privilege('transferpro_app', 'app.tenant_member'::regclass, 'UPDATE') as can_update,
              has_table_privilege('transferpro_app', 'app.tenant_member'::regclass, 'DELETE') as can_delete`,
    )
    expect(view.rows).toEqual([{
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    }])
  }
  finally {
    client.release()
  }
})
