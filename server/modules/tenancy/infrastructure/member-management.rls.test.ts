import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * Member management RLS tests: changing roles and removing members across tenants.
 * A member of Tenant A cannot change roles or remove members in Tenant B.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

const databaseUrl = process.env.DATABASE_URL
const authDatabaseUrl = process.env.AUTH_DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')
if (!authDatabaseUrl)
  throw new Error('AUTH_DATABASE_URL is required (the transferpro_auth role)')

const appPool = new pg.Pool({ connectionString: databaseUrl })
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })

const tenantA = '33333333-3333-4333-8333-333333333333'
const tenantB = '44444444-4444-4444-8444-444444444444'
const userA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const userB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const memberA = 'member-cccccccc'
const memberB = 'member-dddddddd'
const emailA = 'cora@example.com'
const emailB = 'dana@example.com'

beforeAll(async () => {
  const auth = await authPool.connect()
  try {
    await auth.query('begin')
    await auth.query('delete from auth.member where id = any($1::text[])', [[memberA, memberB]])
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

it('a member of tenant A cannot see or modify tenant B members', async () => {
  const auth = await authPool.connect()
  try {
    await auth.query('begin')
    await auth.query(
      `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Cora', $2, true, now(), now()),
              ($3, 'Dana', $4, true, now(), now())`,
      [userA, emailA, userB, emailB],
    )
    await auth.query(
      `insert into auth.organization (id, name, slug, created_at)
       values ($1, 'Tenant A', 'tenant-a-member', now()),
              ($2, 'Tenant B', 'tenant-b-member', now())`,
      [tenantA, tenantB],
    )
    await auth.query(
      `insert into auth.member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, 'admin', now()),
              ($4, $5, $6, 'dispatcher', now())`,
      [memberA, tenantA, userA, memberB, tenantB, userB],
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

  // Tenant A session sees only Cora
  const seenByA = await withApp(tenantA, async (client) => {
    const selected = await client.query('select user_id, name, role from app.tenant_member')
    return selected.rows
  })
  expect(seenByA).toEqual([{ user_id: userA, name: 'Cora', role: 'admin' }])

  // Tenant B session sees only Dana
  const seenByB = await withApp(tenantB, async (client) => {
    const selected = await client.query('select user_id, name, role from app.tenant_member')
    return selected.rows
  })
  expect(seenByB).toEqual([{ user_id: userB, name: 'Dana', role: 'dispatcher' }])

  // Attempting to read members through auth.member directly fails (no grant to app role)
  await expect(withApp(tenantA, client =>
    client.query('select * from auth.member'))).rejects.toThrow(/permission denied/)
})

it('session revocation targets only the removed user in the specific tenant', async () => {
  const auth = await authPool.connect()
  const sessionA1 = 'session-a1-cccccccc'
  const sessionA2 = 'session-a2-cccccccc'
  const sessionB1 = 'session-b1-dddddddd'
  try {
    await auth.query('begin')
    // Create sessions for user A in tenant A (two sessions) and user B in tenant B
    await auth.query(
      `insert into auth.session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
       values ($1, 'token-a1', $2, $3, now() + interval '1 day', now(), now()),
              ($4, 'token-a2', $2, $3, now() + interval '1 day', now(), now()),
              ($5, 'token-b1', $6, $7, now() + interval '1 day', now(), now())`,
      [sessionA1, userA, tenantA, sessionA2, sessionB1, userB, tenantB],
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

  // Verify sessions exist
  const before = await authPool.query(
    'select id from auth.session where id = any($1::text[])',
    [[sessionA1, sessionA2, sessionB1]],
  )
  expect(before.rows.map(r => r.id).sort()).toEqual([sessionA1, sessionA2, sessionB1].sort())

  // Revoke sessions for user A in tenant A (simulating member removal)
  await authPool.query(
    'delete from auth.session where user_id = $1 and active_organization_id = $2',
    [userA, tenantA],
  )

  // User A's sessions in tenant A are gone
  const afterA = await authPool.query(
    'select id from auth.session where user_id = $1 and active_organization_id = $2',
    [userA, tenantA],
  )
  expect(afterA.rows).toEqual([])

  // User B's session in tenant B is still there
  const afterB = await authPool.query(
    'select id from auth.session where user_id = $1 and active_organization_id = $2',
    [userB, tenantB],
  )
  expect(afterB.rows.map(r => r.id)).toEqual([sessionB1])
})
