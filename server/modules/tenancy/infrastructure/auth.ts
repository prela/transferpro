import type { account, invitation, member, organization, session, user, verification } from '../../../../db/auth-schema'
import type { AppEnv } from '../../../core/index'
import process from 'node:process'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { organization as organizationPlugin } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { z } from 'zod'
import * as authSchema from '../../../../db/auth-schema'

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

export interface Membership {
  readonly organizationId: string
  readonly role: string
}

export function createAuth(env: Pick<AppEnv, 'AUTH_DATABASE_URL' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>) {
  const pool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL })
  const db = drizzle(pool, { schema })
  // Secure only in production, so a local http sign-in still sets a cookie.
  // The name prefix `__Secure-` is tied to that flag by Better Auth.
  const secureCookies = process.env.NODE_ENV === 'production'
  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      // Decision 3.10.2026: no public signup. The operator script creates the admin.
      disableSignUp: true,
    },
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
        },
      },
    },
    plugins: [
      organizationPlugin({
        // The person who opens a Tenant is its admin, not an owner.
        creatorRole: 'admin',
      }),
    ],
  })
  return {
    auth,
    close: () => pool.end(),
    /**
     * Memberships only: organization id and role. The email stays on auth.user.
     * This pool is the auth role. The app role cannot read this table.
     */
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
