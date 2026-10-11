import type { account, invitation, member, organization, session, user, verification } from '../../../../db/auth-schema'
import type { AppEnv } from '../../../core/index'
import type { Mailer } from './mailer'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { organization as organizationPlugin } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { z } from 'zod'
import * as authSchema from '../../../../db/auth-schema'
import { inviteLink, SUPERADMIN_SESSION_SECONDS, tenantRoleSchema } from '../../../../shared'
import { nodeEnv } from '../../../core/index'
import { deliverInvitationEmail, inviteSendState } from './invite-send'
import { invitationExpiresInSeconds, organizationRoles } from './tenant-roles'

/**
 * A Tenant is one Better Auth organization.
 * This pool is the auth role. The app role never receives these tables.
 */
const schema = {
  user: authSchema.user,
  session: authSchema.session,
  account: authSchema.account,
  verification: authSchema.verification,
  organization: authSchema.organization,
  member: authSchema.member,
  invitation: authSchema.invitation,
} satisfies {
  user: typeof user
  session: typeof session
  account: typeof account
  verification: typeof verification
  organization: typeof organization
  member: typeof member
  invitation: typeof invitation
}

const membershipRow = z.object({
  organization_id: z.string(),
  role: z.string(),
})

/**
 * Better Auth's own member routes, refused over HTTP (404). Role changes and
 * removals go through /api/members, which holds the Tenant lock, refuses
 * self and last-admin changes, and deletes sessions. update-member-role lets
 * the creator role (admin) past its permission check, and leave skips the
 * lock. The reads return every member's or invitee's email to any member,
 * a driver too; the app reads app.tenant_member and app.tenant_invitation.
 * Server-side `auth.api` calls are not affected.
 */
const disabledPaths = [
  '/organization/update-member-role',
  '/organization/remove-member',
  '/organization/leave',
  '/organization/list-members',
  '/organization/get-full-organization',
  '/organization/list-invitations',
]

export interface Membership {
  readonly organizationId: string
  readonly role: string
}

/**
 * Better Auth enables its limiter in production and leaves it off in development.
 * The sign-in rule is written here so production cannot lose it in a later bump.
 * Three attempts per 10 seconds on `/sign-in/email`.
 */
const emailAttemptRule = {
  window: 10,
  max: 3,
} as const

export function signInRateLimit(nodeEnv: string | undefined) {
  return {
    enabled: nodeEnv === 'production',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': emailAttemptRule,
    },
  }
}

/** Same window and max as email sign-in. Disabled outside production, same as that rule. */
export function acceptAttemptLimit(nodeEnv: string | undefined) {
  const signIn = signInRateLimit(nodeEnv)
  const email = signIn.customRules['/sign-in/email']
  return {
    enabled: signIn.enabled,
    window: email.window,
    max: email.max,
  }
}

/**
 * Counts attempts inside one process. `window` is seconds, matching Better Auth.
 * A disabled rule allows every attempt and stores nothing.
 */
export function createAttemptLimiter(rule: { enabled: boolean, window: number, max: number }) {
  const hits = new Map<string, number[]>()
  return function allow(key: string, nowMs: number): boolean {
    if (!rule.enabled)
      return true
    const horizon = nowMs - rule.window * 1000
    const recent = (hits.get(key) ?? []).filter(at => at > horizon)
    if (recent.length >= rule.max) {
      hits.set(key, recent)
      return false
    }
    recent.push(nowMs)
    hits.set(key, recent)
    return true
  }
}

const invitationRow = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  status: z.string(),
  expires_at: z.coerce.date(),
  organization_id: z.string(),
})

export interface InvitationRecord {
  readonly id: string
  readonly email: string
  readonly role: string | null
  readonly status: string
  readonly expiresAt: Date
  readonly organizationId: string
}

/**
 * Eight hours after the session was created, and not a sliding window.
 * A missing grant leaves the caller's expiresAt alone, so a Tenant member
 * keeps the seven-day session. The select lists user_id only.
 */
const sessionStamp = z.object({
  user_id: z.string(),
  created_at: z.coerce.date(),
})

interface SessionHookContext {
  getSignedCookie?: (name: string, secret: string) => Promise<string | false | null | undefined>
  context?: {
    secret?: string
    authCookies?: { sessionToken?: { name?: string } }
  }
}

/**
 * A refresh sends only the new expiresAt. The signed cookie is the token
 * of the row, so the cap can still be measured from created_at.
 * The database trigger is the backstop when this context is missing.
 */
async function sessionToken(context: unknown): Promise<string | undefined> {
  if (typeof context !== 'object' || context === null)
    return undefined
  const hook = context as SessionHookContext
  const name = hook.context?.authCookies?.sessionToken?.name
  const secret = hook.context?.secret
  if (!name || !secret || !hook.getSignedCookie)
    return undefined
  const token = await hook.getSignedCookie(name, secret)
  return typeof token === 'string' && token !== '' ? token : undefined
}

async function superadminExpiresAt(
  pool: pg.Pool,
  session: { id?: string, userId?: string, createdAt?: Date },
  context?: unknown,
): Promise<Date | undefined> {
  let userId = session.userId
  let createdAt = session.createdAt
  if (!userId || !createdAt) {
    const token = await sessionToken(context)
    const existing = session.id
      ? await pool.query('select user_id, created_at from auth.session where id = $1', [session.id])
      : token
        ? await pool.query('select user_id, created_at from auth.session where token = $1', [token])
        : undefined
    const row = sessionStamp.safeParse(existing?.rows[0])
    if (row.success) {
      userId ??= row.data.user_id
      createdAt ??= row.data.created_at
    }
  }
  if (!userId || !createdAt)
    return undefined
  const grant = await pool.query(
    'select user_id from platform.superadmin where user_id = $1',
    [userId],
  )
  if ((grant.rowCount ?? 0) === 0)
    return undefined
  return new Date(createdAt.getTime() + SUPERADMIN_SESSION_SECONDS * 1000)
}

async function capSuperadminSession(
  pool: pg.Pool,
  session: { id?: string, userId?: string, createdAt?: Date },
  context: unknown,
) {
  const expiresAt = await superadminExpiresAt(pool, session, context)
  if (!expiresAt)
    return
  return { data: { ...session, expiresAt } }
}

export function createAuth(
  env: Pick<AppEnv, 'AUTH_DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>,
  options?: { mailer?: Mailer, rateLimit?: ReturnType<typeof signInRateLimit> },
) {
  const pool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL })
  const db = drizzle(pool, { schema })
  // Secure only in production, so a local http sign-in still sets a cookie.
  // The name prefix `__Secure-` is tied to that flag by Better Auth.
  const secureCookies = nodeEnv() === 'production'
  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    disabledPaths,
    emailAndPassword: {
      enabled: true,
      // Decision 3.10.2026: no public signup. The operator script creates the admin.
      disableSignUp: true,
    },
    // Tests pass the production rule. The app uses NODE_ENV, which is off in test.
    rateLimit: options?.rateLimit ?? signInRateLimit(nodeEnv()),
    advanced: {
      useSecureCookies: secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
      database: {
        // Organization id is text, and app.current_tenant_id() is a uuid.
        generateId: () => crypto.randomUUID(),
      },
    },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    user: {
      additionalFields: {
        locale: {
          type: 'string',
          required: false,
          // The shell writes hr or en through POST /api/locale, not this body.
          input: false,
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A platform owner does not keep the seven-day session.
          // The row's expires_at is what getSession honours.
          before: async (session, context) => capSuperadminSession(pool, session, context),
        },
        update: {
          // A refresh must not stretch an eight-hour session out to seven days.
          before: async (session, context) => capSuperadminSession(pool, session, context),
        },
      },
    },
    plugins: [
      organizationPlugin({
        // The person who opens a Tenant is its admin, not an owner.
        creatorRole: 'admin',
        // Only the operator script creates Tenants (via SQL, so unaffected).
        allowUserToCreateOrganization: false,
        // Roles are built with the default access controller. Passing that
        // controller again makes the plugin option type reject it.
        roles: organizationRoles,
        invitationExpiresIn: invitationExpiresInSeconds,
        // generateId is a function, so Better Auth would treat invitation
        // ids as predictable and demand a verified email. The ids are still
        // random UUIDs. The accept route stores email_verified for the new user.
        requireEmailVerificationOnInvitation: false,
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation: pending }) => {
            if (!tenantRoleSchema.safeParse(pending.role).success)
              throw new APIError('BAD_REQUEST', { message: 'Role is not valid.' })
          },
        },
        async sendInvitationEmail(data) {
          const pending = inviteSendState.getStore()
          const role = tenantRoleSchema.safeParse(data.role)
          if (!role.success)
            return
          await deliverInvitationEmail(options?.mailer, {
            to: data.email,
            inviteUrl: inviteLink(env.BETTER_AUTH_URL, data.id),
            role: role.data,
            tenantName: data.organization.name,
            locale: pending?.locale ?? 'hr',
          })
        },
      }),
    ],
  })
  return {
    auth,
    authPool: pool,
    baseURL: env.BETTER_AUTH_URL,
    close: () => pool.end(),
    async invitationById(id: string): Promise<InvitationRecord | null> {
      const result = await pool.query(
        `select id, email, role, status, expires_at, organization_id
         from auth.invitation where id = $1`,
        [id],
      )
      const row = invitationRow.safeParse(result.rows[0])
      if (!row.success)
        return null
      return {
        id: row.data.id,
        email: row.data.email,
        role: row.data.role,
        status: row.data.status,
        expiresAt: row.data.expires_at,
        organizationId: row.data.organization_id,
      }
    },
    async userIdByEmail(email: string): Promise<string | null> {
      const result = await pool.query(
        'select id from auth."user" where lower(email) = $1',
        [email.toLowerCase()],
      )
      const row = z.object({ id: z.string() }).safeParse(result.rows[0])
      return row.success ? row.data.id : null
    },
    /**
     * The sign-in address for one account. The auth role reads auth.user.
     * The app role does not. Callers copy the value onto a Driver row.
     */
    async emailByUserId(userId: string): Promise<string | null> {
      const result = await pool.query(
        'select email from auth."user" where id = $1',
        [userId],
      )
      const row = z.object({ email: z.string().min(1) }).safeParse(result.rows[0])
      return row.success ? row.data.email : null
    },
    /**
     * Same credential shape as the operator script. email_verified is true
     * because the invitation id is the proof of the mailbox.
     */
    async insertInvitedUser(input: { email: string, name: string, password: string }): Promise<string> {
      const passwordHash = await hashPassword(input.password)
      const userId = crypto.randomUUID()
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(
          `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
           values ($1, $2, $3, true, now(), now())`,
          [userId, input.name, input.email.toLowerCase()],
        )
        await client.query(
          `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
           values ($1, $2, 'credential', $2, $3, now(), now())`,
          [crypto.randomUUID(), userId, passwordHash],
        )
        await client.query('commit')
        return userId
      }
      catch (error) {
        await client.query('rollback')
        throw error
      }
      finally {
        client.release()
      }
    },
    async deleteUser(userId: string): Promise<void> {
      await pool.query('delete from auth."user" where id = $1', [userId])
    },
    /**
     * The name only. The email stays on auth.user, which this query does not read.
     */
    async organizationName(organizationId: string): Promise<string> {
      const result = await pool.query(
        'select name from auth.organization where id = $1',
        [organizationId],
      )
      const row = z.object({ name: z.string().min(1) }).safeParse(result.rows[0])
      if (!row.success)
        throw new Error('Tenant name is missing.')
      return row.data.name
    },
    /**
     * Null until the user chooses. The email is not selected.
     */
    async userLocale(userId: string): Promise<string | null> {
      const result = await pool.query(
        'select locale from auth."user" where id = $1',
        [userId],
      )
      const row = z.object({ locale: z.string().nullable() }).safeParse(result.rows[0])
      if (!row.success)
        throw new Error('User locale is missing.')
      return row.data.locale
    },
    async setUserLocale(userId: string, locale: 'hr' | 'en'): Promise<void> {
      const result = await pool.query(
        'update auth."user" set locale = $1, updated_at = now() where id = $2',
        [locale, userId],
      )
      if ((result.rowCount ?? 0) !== 1)
        throw new Error('User locale was not saved.')
    },
    /**
     * Memberships only: organization id and role. The email stays on auth.user.
     * This pool is the auth role. The app role cannot read this table.
     */
    /**
     * The grant is the row. Selecting user_id is the only column this role has.
     */
    async isSuperadmin(userId: string): Promise<boolean> {
      const result = await pool.query(
        'select user_id from platform.superadmin where user_id = $1',
        [userId],
      )
      return (result.rowCount ?? 0) > 0
    },
    /**
     * A row means the firm is deactivated. organization_id is the only column
     * this role may read. The check does not open schema app.
     */
    async organizationSuspended(organizationId: string): Promise<boolean> {
      const result = await pool.query(
        'select organization_id from platform.tenant_account where organization_id = $1',
        [organizationId],
      )
      return (result.rowCount ?? 0) > 0
    },
    async memberships(userId: string): Promise<Membership[]> {
      const result = await pool.query(
        'select organization_id, role from auth.member where user_id = $1',
        [userId],
      )
      return z.array(membershipRow).parse(result.rows).map(row => ({
        organizationId: row.organization_id,
        role: row.role,
      }))
    },
  }
}

export type AuthHandle = ReturnType<typeof createAuth>
