import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import { z } from 'zod'
import { tenantNameSchema } from '../../../../shared'
import { appendPlatformAudit } from './audit'

/**
 * Operator commands. They run as transferpro_owner, in one transaction.
 * Routes do not call them. A Postgres detail can contain an email, so it
 * is never copied onto the error.
 */
export class PlatformOperatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformOperatorError'
  }
}

const roleRow = z.object({ role: z.string() })

/** Stored on the audit row. It is the role, not a person's name. */
const OPERATOR_ACTOR = 'transferpro_owner'

const createSchema = z.object({
  name: tenantNameSchema,
  email: z.email(),
  password: z.string().min(8).max(128),
  migrateDatabaseUrl: z.url(),
})

const emailSchema = z.object({
  email: z.email(),
  migrateDatabaseUrl: z.url(),
})

const accountSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  active: z.boolean(),
  migrateDatabaseUrl: z.url(),
})

export interface CreateSuperadminInput {
  readonly name: string
  readonly email: string
  readonly password: string
  readonly migrateDatabaseUrl: string
}

/** One owner transaction: user, credential, grant. No organization and no member. */
export async function createSuperadmin(input: CreateSuperadminInput): Promise<void> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map(issue => String(issue.path[0])))
    if (fields.has('password'))
      throw new PlatformOperatorError('Password must be 8 to 128 characters.')
    if (fields.has('migrateDatabaseUrl'))
      throw new PlatformOperatorError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role.')
    throw new PlatformOperatorError('Name and email must be valid.')
  }
  const email = parsed.data.email.toLowerCase()
  const pool = new pg.Pool({ connectionString: parsed.data.migrateDatabaseUrl, max: 1 })
  try {
    await assertOwner(pool)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const existing = await client.query(
        `select id,
                exists(select 1 from auth.member where user_id = auth."user".id) as member,
                exists(select 1 from platform.superadmin where user_id = auth."user".id) as superadmin
         from auth."user"
         where lower(email) = $1`,
        [email],
      )
      if ((existing.rowCount ?? 0) > 0)
        throw new PlatformOperatorError('A platform owner cannot be created for that account.')
      const userId = crypto.randomUUID()
      const passwordHash = await hashPassword(parsed.data.password)
      await client.query(
        `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
         values ($1, $2, $3, true, now(), now())`,
        [userId, parsed.data.name, email],
      )
      await client.query(
        `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         values ($1, $2, 'credential', $2, $3, now(), now())`,
        [crypto.randomUUID(), userId, passwordHash],
      )
      await client.query(
        'insert into platform.superadmin (user_id) values ($1)',
        [userId],
      )
      await client.query('commit')
    }
    catch (error) {
      await client.query('rollback')
      throw operatorFailure(error)
    }
    finally {
      client.release()
    }
  }
  finally {
    await pool.end()
  }
}

/** Deletes the grant row and leaves the user. */
export async function revokeSuperadmin(input: { email: string, migrateDatabaseUrl: string }): Promise<void> {
  const parsed = emailSchema.safeParse(input)
  if (!parsed.success) {
    if (parsed.error.issues.some(issue => issue.path[0] === 'migrateDatabaseUrl'))
      throw new PlatformOperatorError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role.')
    throw new PlatformOperatorError('Email must be valid.')
  }
  const pool = new pg.Pool({ connectionString: parsed.data.migrateDatabaseUrl, max: 1 })
  try {
    await assertOwner(pool)
    const result = await pool.query(
      `delete from platform.superadmin
       where user_id in (select id from auth."user" where lower(email) = $1)`,
      [parsed.data.email.toLowerCase()],
    )
    if ((result.rowCount ?? 0) !== 1)
      throw new PlatformOperatorError('No platform owner matches that account.')
  }
  finally {
    await pool.end()
  }
}

export interface SetTenantActiveInput {
  readonly slug: string
  readonly active: boolean
  readonly migrateDatabaseUrl: string
}

/** Deactivate inserts the row. Reactivate deletes it. A no-op appends nothing. */
export async function setTenantActive(input: SetTenantActiveInput): Promise<'changed' | 'unchanged'> {
  const parsed = accountSchema.safeParse(input)
  if (!parsed.success) {
    if (parsed.error.issues.some(issue => issue.path[0] === 'migrateDatabaseUrl'))
      throw new PlatformOperatorError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role.')
    throw new PlatformOperatorError('The slug is lowercase letters, digits, and hyphens.')
  }
  const pool = new pg.Pool({ connectionString: parsed.data.migrateDatabaseUrl, max: 1 })
  try {
    await assertOwner(pool)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await client.query<{ id: string }>(
        'select id from auth.organization where slug = $1',
        [parsed.data.slug],
      )
      const tenantId = organization.rows[0]?.id
      if (!tenantId)
        throw new PlatformOperatorError('No tenant matches that slug.')
      const changed = parsed.data.active
        ? await reactivate(client, tenantId)
        : await deactivate(client, tenantId)
      if (changed) {
        await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
        await appendPlatformAudit(client, {
          action: parsed.data.active ? 'tenant.reactivated' : 'tenant.suspended',
          actorUserId: OPERATOR_ACTOR,
        })
      }
      await client.query('commit')
      return changed ? 'changed' : 'unchanged'
    }
    catch (error) {
      await client.query('rollback')
      if (error instanceof PlatformOperatorError)
        throw error
      throw new PlatformOperatorError('Could not update the tenant account.')
    }
    finally {
      client.release()
    }
  }
  finally {
    await pool.end()
  }
}

async function deactivate(client: pg.PoolClient, tenantId: string): Promise<boolean> {
  const inserted = await client.query(
    `insert into platform.tenant_account (organization_id, suspended_at)
     values ($1, now())
     on conflict (organization_id) do nothing`,
    [tenantId],
  )
  return (inserted.rowCount ?? 0) === 1
}

async function reactivate(client: pg.PoolClient, tenantId: string): Promise<boolean> {
  const deleted = await client.query(
    'delete from platform.tenant_account where organization_id = $1',
    [tenantId],
  )
  return (deleted.rowCount ?? 0) === 1
}

async function assertOwner(pool: pg.Pool): Promise<void> {
  const result = await pool.query('select current_user as role')
  const role = roleRow.parse(result.rows[0]).role
  if (role !== 'transferpro_owner')
    throw new PlatformOperatorError(`This connection is ${role}. It must be transferpro_owner.`)
}

function operatorFailure(error: unknown): PlatformOperatorError {
  if (error instanceof PlatformOperatorError)
    return error
  // 23505 unique email, 42501 the exclusion trigger. Neither message is copied.
  if (isCode(error, '23505') || isCode(error, '42501'))
    return new PlatformOperatorError('A platform owner cannot be created for that account.')
  return new PlatformOperatorError('Could not change the platform owner.')
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
