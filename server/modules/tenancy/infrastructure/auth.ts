import type { account, invitation, member, organization, session, user, verification } from '../../../../db/auth-schema'
import type { AppEnv } from '../../../core/index'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { organization as organizationPlugin } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
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

export function createAuth(env: AppEnv) {
  const pool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL })
  const db = drizzle(pool, { schema })
  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    advanced: {
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
  }
}
