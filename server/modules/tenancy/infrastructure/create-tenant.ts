import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import { z } from 'zod'

/**
 * Creates one Tenant and its admin.
 *
 * `authDatabaseUrl` must be `transferpro_auth`. That role inserts the user,
 * the credential, the organization, and the admin member. It has no grant
 * on schema `app`.
 * `migrateDatabaseUrl` must be `transferpro_owner`. That role inserts the
 * one `app.tenant_settings` row and sets `tenant_id` explicitly, because
 * the owner bypasses row-level security and `app.current_tenant_id()` is
 * null on that connection. The app role is not used.
 *
 * Times are `timestamptz` UTC (`now()`). `Europe/Zagreb` is the display
 * zone only. The default locale is `hr` until the user chooses one.
 */
export interface CreateTenantInput {
  readonly name: string
  readonly slug: string
  readonly adminEmail: string
  readonly adminName: string
  readonly password: string
  readonly authDatabaseUrl: string
  readonly migrateDatabaseUrl: string
}

export interface CreatedTenant {
  readonly tenantId: string
  readonly adminUserId: string
}

export class TenantProvisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantProvisionError'
  }
}

const inputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  adminEmail: z.email(),
  adminName: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(128),
  authDatabaseUrl: z.url(),
  migrateDatabaseUrl: z.url(),
})

const roleRow = z.object({ role: z.string() })

const TENANT_TIME_ZONE = 'Europe/Zagreb'
const TENANT_DEFAULT_LOCALE = 'hr'

export async function createTenant(input: CreateTenantInput): Promise<CreatedTenant> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map(issue => String(issue.path[0])))
    if (fields.has('password'))
      throw new TenantProvisionError('Password must be 8 to 128 characters.')
    if (fields.has('authDatabaseUrl') || fields.has('migrateDatabaseUrl'))
      throw new TenantProvisionError('AUTH_DATABASE_URL and DATABASE_MIGRATE_URL must be set.')
    throw new TenantProvisionError('Name, slug, and admin email must be valid. The slug is lowercase letters, digits, and hyphens.')
  }

  const email = parsed.data.adminEmail.toLowerCase()
  const { name, slug, adminName, password, authDatabaseUrl, migrateDatabaseUrl } = parsed.data

  // Refuse the app role before any insert. The message names the role, not the URL.
  await assertRole(authDatabaseUrl, 'transferpro_auth')
  await assertRole(migrateDatabaseUrl, 'transferpro_owner')

  const tenantId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  // Better Auth's own hasher, so sign-in can verify the credential.
  const passwordHash = await hashPassword(password)

  // Duplicates are refused before either write, so a retry of a failed
  // login insert can still create the tenant.
  await assertNoDuplicate(authDatabaseUrl, slug, email)
  // Settings first. A crash before the login insert leaves an unused
  // settings row, not a Tenant that can sign in without Europe/Zagreb.
  await insertSettings(migrateDatabaseUrl, tenantId)
  try {
    await insertAuth(authDatabaseUrl, {
      tenantId,
      userId,
      name,
      slug,
      email,
      adminName,
      passwordHash,
    })
  }
  catch (error) {
    await deleteSettings(migrateDatabaseUrl, tenantId)
    throw error
  }

  return { tenantId, adminUserId: userId }
}

async function assertNoDuplicate(connectionString: string, slug: string, email: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const slugTaken = await pool.query('select 1 from auth.organization where slug = $1', [slug])
    if ((slugTaken.rowCount ?? 0) > 0)
      throw new TenantProvisionError('A tenant with this slug already exists.')
    const emailTaken = await pool.query('select 1 from auth."user" where lower(email) = $1', [email])
    if ((emailTaken.rowCount ?? 0) > 0)
      throw new TenantProvisionError('A user with this email already exists.')
  }
  finally {
    await pool.end()
  }
}

async function insertAuth(
  connectionString: string,
  row: {
    tenantId: string
    userId: string
    name: string
    slug: string
    email: string
    adminName: string
    passwordHash: string
  },
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, true, now(), now())`,
        [row.userId, row.adminName, row.email],
      )
      await client.query(
        `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $2, $3, now(), now())`,
        [crypto.randomUUID(), row.userId, row.passwordHash],
      )
      await client.query(
        `insert into auth.organization (id, name, slug, created_at)
       values ($1, $2, $3, now())`,
        [row.tenantId, row.name, row.slug],
      )
      await client.query(
        `insert into auth.member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, 'admin', now())`,
        [crypto.randomUUID(), row.tenantId, row.userId],
      )
      await client.query('commit')
    }
    catch (error) {
      await client.query('rollback')
      throw provisionFailure(error)
    }
    finally {
      client.release()
    }
  }
  finally {
    await pool.end()
  }
}

async function assertRole(connectionString: string, expected: 'transferpro_auth' | 'transferpro_owner'): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const result = await pool.query('select current_user as role')
    const role = roleRow.parse(result.rows[0]).role
    if (role !== expected)
      throw new TenantProvisionError(`This connection is ${role}. It must be ${expected}.`)
  }
  finally {
    await pool.end()
  }
}

/**
 * The owner writes one row. The column default would call
 * `app.current_tenant_id()`, which is null here, so the id is explicit.
 */
async function insertSettings(connectionString: string, tenantId: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    await pool.query(
      `insert into app.tenant_settings (tenant_id, default_locale, time_zone)
       values ($1, $2, $3)`,
      [tenantId, TENANT_DEFAULT_LOCALE, TENANT_TIME_ZONE],
    )
  }
  finally {
    await pool.end()
  }
}

async function deleteSettings(connectionString: string, tenantId: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    await pool.query('delete from app.tenant_settings where tenant_id = $1', [tenantId])
  }
  finally {
    await pool.end()
  }
}

/**
 * Our own messages only. A Postgres `detail` can contain the email or the
 * password hash, so it is not copied onto the error.
 */
function provisionFailure(error: unknown): TenantProvisionError {
  if (error instanceof TenantProvisionError)
    return error
  if (isUniqueViolation(error)) {
    const constraint = 'constraint' in error && typeof error.constraint === 'string' ? error.constraint : ''
    if (constraint.includes('slug'))
      return new TenantProvisionError('A tenant with this slug already exists.')
    if (constraint.includes('email'))
      return new TenantProvisionError('A user with this email already exists.')
    return new TenantProvisionError('A tenant with this slug or email already exists.')
  }
  return new TenantProvisionError('Could not create the tenant.')
}

function isUniqueViolation(error: unknown): error is { code: string, constraint?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
