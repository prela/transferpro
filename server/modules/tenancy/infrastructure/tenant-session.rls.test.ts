import { spawnSync } from 'node:child_process'
import { loadEnvFile } from 'node:process'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { closeTenantRuntime, TenantAccessError, withTenantFromSession } from '..'
import { handleLoggedError, parseAppEnv, runWithRequestId } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { createAuth } from './auth'
import { createTenant } from './create-tenant'

/**
 * Session seam: the operator script, the Better Auth cookie, and
 * withTenantFromSession. Rows are the observation. Policy text is not.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(value: string | undefined, name: string): string {
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const databaseUrl = process.env.DATABASE_URL
const authDatabaseUrl = process.env.AUTH_DATABASE_URL
const queueDatabaseUrl = process.env.QUEUE_DATABASE_URL
const ownerUrl = process.env.DATABASE_MIGRATE_URL
const baseUrl = required(process.env.BETTER_AUTH_URL, 'BETTER_AUTH_URL')
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')
if (!authDatabaseUrl)
  throw new Error('AUTH_DATABASE_URL is required (the transferpro_auth role)')
if (!queueDatabaseUrl)
  throw new Error('QUEUE_DATABASE_URL is required (the transferpro_queue role)')
if (!ownerUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const env = parseAppEnv({
  DATABASE_URL: databaseUrl,
  AUTH_DATABASE_URL: authDatabaseUrl,
  QUEUE_DATABASE_URL: queueDatabaseUrl,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: baseUrl,
})

const password = 'slice10-session-password'
const scriptEmail = 'slice10-admin@example.com'
const scriptSlug = 'slice10-pilot'

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: ownerUrl })

const fixtures = [
  { slug: scriptSlug, email: scriptEmail },
  { slug: 'slice10-other', email: scriptEmail },
  { slug: 'slice10-tenant-a', email: 'slice10-a@example.com' },
  { slug: 'slice10-tenant-b', email: 'slice10-b@example.com' },
  { slug: 'slice10-nomember', email: 'slice10-nomember@example.com' },
  { slug: 'slice10-prod', email: 'slice10-prod@example.com' },
  { slug: 'slice10-no-create-org', email: 'slice10-no-create-org@example.com' },
]

const settingsRows = z.object({
  rows: z.array(z.object({
    default_locale: z.string(),
    time_zone: z.string(),
  })),
  rowCount: z.number().nullable(),
})

let auth: ReturnType<typeof createAuth> | undefined

function currentAuth(): ReturnType<typeof createAuth> {
  if (!auth)
    throw new Error('auth is not open')
  return auth
}

beforeAll(async () => {
  auth = createAuth(env)
  for (const fixture of fixtures)
    await removeFixture(fixture.slug, fixture.email)
})

afterAll(async () => {
  for (const fixture of fixtures)
    await removeFixture(fixture.slug, fixture.email)
  await auth?.close()
  await closeTenantRuntime()
  await authPool.end()
  await ownerPool.end()
})

it('refuses the app role for provisioning', async () => {
  await expect(createTenant({
    name: 'Pilot',
    slug: 'slice10-app-role',
    adminEmail: 'slice10-app-role@example.com',
    adminName: 'Ada',
    password,
    authDatabaseUrl: databaseUrl,
    migrateDatabaseUrl: ownerUrl,
  })).rejects.toThrow(/It must be transferpro_auth/)

  await expect(createTenant({
    name: 'Pilot',
    slug: 'slice10-owner-as-auth',
    adminEmail: 'slice10-owner-as-auth@example.com',
    adminName: 'Ada',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl: authDatabaseUrl,
  })).rejects.toThrow(/It must be transferpro_owner/)
})

it('the sign-up endpoint is disabled', async () => {
  const response = await currentAuth().auth.handler(new Request(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
    },
    body: JSON.stringify({
      name: 'Ada',
      email: 'slice10-signup@example.com',
      password,
    }),
  }))
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('EMAIL_PASSWORD_SIGN_UP_DISABLED')
})

it('a signed-in admin cannot create an organization', async () => {
  await createTenant({
    name: 'Cannot Create Org',
    slug: 'slice10-no-create-org',
    adminEmail: 'slice10-no-create-org@example.com',
    adminName: 'Ada',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl: ownerUrl,
  })
  const signedIn = await signIn('slice10-no-create-org@example.com')

  // Positive control: the session is valid and authenticated
  const sessionCheck = await currentAuth().auth.handler(new Request(`${baseUrl}/api/auth/get-session`, {
    headers: {
      origin: baseUrl,
      cookie: signedIn.token,
    },
  }))
  expect(sessionCheck.status).toBe(200)

  // Try to create an organization through the Better Auth endpoint
  const response = await currentAuth().auth.handler(new Request(`${baseUrl}/api/auth/organization/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
      'cookie': signedIn.token,
    },
    body: JSON.stringify({
      name: 'Unauthorized Tenant',
      slug: 'slice10-unauthorized',
    }),
  }))

  // Better Auth returns 403 with a specific error when allowUserToCreateOrganization: false
  expect(response.status).toBe(403)
  const body = await response.text()
  expect(body).toContain('You are not allowed to create a new organization')

  // Verify the slug was not created
  const check = await authPool.query('select 1 from auth.organization where slug = $1', ['slice10-unauthorized'])
  expect(check.rowCount).toBe(0)
})

it('the provisioning script creates a tenant and an admin who can sign in and sign out', async () => {
  const created = runScript([
    '--name',
    'Pilot',
    '--slug',
    scriptSlug,
    '--admin-email',
    scriptEmail,
    '--admin-name',
    'Ada',
  ], password)
  expect(created.stderr).not.toContain(password)
  expect(created.stdout).not.toContain(password)
  expect(created.status).toBe(0)
  expect(created.stdout).toContain(`created tenant ${scriptSlug}`)

  const signedIn = await signIn(scriptEmail)
  expect(signedIn.cookie.toLowerCase()).toContain('httponly')
  expect(signedIn.cookie.toLowerCase()).toContain('samesite=lax')
  expect(signedIn.cookie.toLowerCase()).not.toContain('secure')

  const session = await getSession(signedIn.token)
  expect(session).toMatchObject({ user: { email: scriptEmail } })

  const logs = captureLogs()
  const seen = await runWithRequestId('req-slice-10', () =>
    withTenantFromSession(signedIn.headers, async ({ context, transaction }) => {
      logs.logger.info({ event: 'tenant-read' }, 'read settings')
      const selected = settingsRows.parse(await transaction.execute(sql`
        select default_locale, time_zone from app.tenant_settings
      `))
      return { tenantId: context.tenantId, rows: selected.rows }
    }))

  expect(seen.rows).toEqual([{ default_locale: 'hr', time_zone: 'Europe/Zagreb' }])
  expect(logs.lines()[0]).toMatchObject({
    request_id: 'req-slice-10',
    tenant_id: seen.tenantId,
    event: 'tenant-read',
  })

  const signedOut = await signOut(signedIn.token)
  expect(signedOut.toLowerCase()).toContain('httponly')
  expect(signedOut.toLowerCase()).toContain('samesite=lax')
  expect(signedOut.toLowerCase()).toContain('max-age=0')
  expect(await getSession(signedIn.token)).toBeNull()

  const unsigned = await withTenantFromSession(signedIn.headers, async () => 'still in')
    .catch(error => error)
  expect(unsigned).toBeInstanceOf(TenantAccessError)
  expect(handleLoggedError(logs.logger, unsigned, 'req-slice-10')).toEqual({
    statusCode: 401,
    message: 'Unauthorized',
    request_id: 'req-slice-10',
  })
})

it('the provisioning script refuses a duplicate slug or email', () => {
  const again = runScript([
    '--name',
    'Pilot',
    '--slug',
    scriptSlug,
    '--admin-email',
    'slice10-second@example.com',
    '--admin-name',
    'Bea',
  ], password)
  expect(again.status).toBe(1)
  expect(scriptOutput(again.stderr)).toContain('A tenant with this slug already exists.')
  expect(again.stdout).not.toContain('created tenant')
  expect(scriptOutput(again.stderr)).not.toContain(password)

  const sameEmail = runScript([
    '--name',
    'Other',
    '--slug',
    'slice10-other',
    '--admin-email',
    scriptEmail,
    '--admin-name',
    'Bea',
  ], password)
  expect(sameEmail.status).toBe(1)
  expect(scriptOutput(sameEmail.stderr)).toContain('A user with this email already exists.')
  // The message names the collision. It does not repeat the address.
  expect(scriptOutput(sameEmail.stderr)).not.toContain(scriptEmail)
  expect(scriptOutput(sameEmail.stderr)).not.toContain(password)
})

it('the provisioning script refuses a password argument', () => {
  const secret = 'slice10-argv-password'
  const result = runScript([
    '--name',
    'Pilot',
    '--slug',
    'slice10-argv',
    '--admin-email',
    'slice10-argv@example.com',
    '--admin-name',
    'Ada',
    '--password',
    secret,
  ], secret)
  expect(result.status).not.toBe(0)
  expect(scriptOutput(result.stderr)).toContain('Password must not be passed as an argument.')
  expect(result.stdout).not.toContain(secret)
  // pnpm reprints the command line on failure. The script's own lines do not.
  expect(scriptOutput(result.stderr)).not.toContain(secret)
})

it('the session cookie is Secure in production', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const prod = createAuth(env)
  try {
    await createTenant({
      name: 'Prod',
      slug: 'slice10-prod',
      adminEmail: 'slice10-prod@example.com',
      adminName: 'Ada',
      password,
      authDatabaseUrl,
      migrateDatabaseUrl: ownerUrl,
    })
    const signedIn = await signIn('slice10-prod@example.com', prod)
    expect(signedIn.cookie).toContain('__Secure-')
    expect(signedIn.cookie.toLowerCase()).toContain('secure')
    expect(signedIn.cookie.toLowerCase()).toContain('httponly')
    expect(signedIn.cookie.toLowerCase()).toContain('samesite=lax')
  }
  finally {
    process.env.NODE_ENV = previous
    await prod.close()
  }
})

it('a signed-in user with no membership is forbidden', async () => {
  const created = await createTenant({
    name: 'No member',
    slug: 'slice10-nomember',
    adminEmail: 'slice10-nomember@example.com',
    adminName: 'Ada',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl: ownerUrl,
  })
  await authPool.query('delete from auth.member where user_id = $1', [created.adminUserId])

  const signedIn = await signIn('slice10-nomember@example.com')
  const error = await withTenantFromSession(signedIn.headers, async () => 'allowed').catch(caught => caught)
  expect(error).toBeInstanceOf(TenantAccessError)
  expect((error as TenantAccessError).statusCode).toBe(403)
  const logs = captureLogs()
  expect(handleLoggedError(logs.logger, error, 'req-no-member')).toEqual({
    statusCode: 403,
    message: 'Forbidden',
    request_id: 'req-no-member',
  })
})

it('a user of tenant B cannot read or change tenant A rows through the session helper', async () => {
  const tenantA = await createTenant({
    name: 'Tenant A',
    slug: 'slice10-tenant-a',
    adminEmail: 'slice10-a@example.com',
    adminName: 'Ana',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl: ownerUrl,
  })
  await createTenant({
    name: 'Tenant B',
    slug: 'slice10-tenant-b',
    adminEmail: 'slice10-b@example.com',
    adminName: 'Boris',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl: ownerUrl,
  })

  const signedIn = await signIn('slice10-b@example.com')
  const logs = captureLogs()
  const seenByB = await runWithRequestId('req-tenant-b', () =>
    withTenantFromSession(signedIn.headers, async ({ context, transaction }) => {
      const updated = settingsRows.parse(await transaction.execute(sql`
        update app.tenant_settings set default_locale = 'en'
      `))
      const selected = settingsRows.parse(await transaction.execute(sql`
        select default_locale, time_zone from app.tenant_settings
      `))
      logs.logger.info({ event: 'tenant-b' }, 'read settings')
      return { tenantId: context.tenantId, rows: selected.rows, updated: updated.rowCount }
    }))

  expect(seenByB.updated).toBe(1)
  expect(seenByB.rows).toEqual([{ default_locale: 'en', time_zone: 'Europe/Zagreb' }])
  expect(seenByB.tenantId).not.toBe(tenantA.tenantId)
  expect(logs.lines()[0]).toMatchObject({
    request_id: 'req-tenant-b',
    tenant_id: seenByB.tenantId,
  })

  const signedInA = await signIn('slice10-a@example.com')
  const seenByA = await withTenantFromSession(signedInA.headers, async ({ context, transaction }) => {
    const selected = settingsRows.parse(await transaction.execute(sql`
      select default_locale, time_zone from app.tenant_settings
    `))
    return { tenantId: context.tenantId, rows: selected.rows }
  })
  expect(seenByA.tenantId).toBe(tenantA.tenantId)
  expect(seenByA.rows).toEqual([{ default_locale: 'hr', time_zone: 'Europe/Zagreb' }])
})

/** pnpm's lifecycle line repeats argv. The script's own text is what we assert. */
function scriptOutput(stderr: string): string {
  return stderr
    .split('\n')
    .filter(line => line !== '' && !line.startsWith('$ ') && !line.startsWith('[ELIFECYCLE]'))
    .join('\n')
}

function runScript(args: string[], stdinPassword: string) {
  return spawnSync('pnpm', ['tenant:create', '--', ...args], {
    input: `${stdinPassword}\n`,
    encoding: 'utf8',
    cwd: process.cwd(),
  })
}

async function signIn(email: string, handle: ReturnType<typeof createAuth> = currentAuth()) {
  const response = await handle.auth.handler(new Request(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
    },
    body: JSON.stringify({ email, password }),
  }))
  expect(response.status, await response.clone().text()).toBe(200)
  const cookie = response.headers.getSetCookie().find(part => part.includes('session_token'))
  if (!cookie)
    throw new Error('sign-in did not set a session cookie')
  const token = cookie.split(';')[0] ?? ''
  const headers = new Headers({ cookie: token })
  return { cookie, token, headers }
}

async function signOut(token: string): Promise<string> {
  const response = await currentAuth().auth.handler(new Request(`${baseUrl}/api/auth/sign-out`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
      'cookie': token,
    },
  }))
  expect(response.status).toBe(200)
  const cookie = response.headers.getSetCookie().find(part => part.includes('session_token'))
  if (!cookie)
    throw new Error('sign-out did not clear the session cookie')
  return cookie
}

async function getSession(token: string): Promise<{ user: { email: string } } | null> {
  const response = await currentAuth().auth.handler(new Request(`${baseUrl}/api/auth/get-session`, {
    headers: {
      origin: baseUrl,
      cookie: token,
    },
  }))
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  if (body === null)
    return null
  return z.object({
    user: z.object({ email: z.string() }),
  }).parse(body)
}

async function removeFixture(slug: string, email: string) {
  const owner = await ownerPool.connect()
  try {
    await owner.query(
      `delete from app.tenant_settings
       where tenant_id::text in (select id from auth.organization where slug = $1)`,
      [slug],
    )
  }
  finally {
    owner.release()
  }

  const client = await authPool.connect()
  try {
    await client.query('begin')
    await client.query(
      `delete from auth.session where user_id in (select id from auth."user" where lower(email) = $1)`,
      [email],
    )
    await client.query(
      `delete from auth.account where user_id in (select id from auth."user" where lower(email) = $1)`,
      [email],
    )
    await client.query(
      `delete from auth.member
       where organization_id in (select id from auth.organization where slug = $1)
          or user_id in (select id from auth."user" where lower(email) = $2)`,
      [slug, email],
    )
    await client.query(
      `delete from auth.invitation where organization_id in (select id from auth.organization where slug = $1)`,
      [slug],
    )
    await client.query('delete from auth.organization where slug = $1', [slug])
    await client.query('delete from auth."user" where lower(email) = $1', [email])
    await client.query('commit')
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}
