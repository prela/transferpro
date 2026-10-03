import { sql } from 'drizzle-orm'
import { boolean, check, pgSchema, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Better Auth tables. Not tenant tables: no tenant_id, no row-level security.
 * The app role has no grant here. The auth role does.
 * Instants are `timestamptz` UTC. A Tenant's time zone is for display only.
 */
export const authSchema = pgSchema('auth')

function instant(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' })
}

function createdAt() {
  return instant('created_at').notNull()
}

function updatedAt() {
  return instant('updated_at').notNull()
}

export const user = authSchema.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // Null means the Tenant's default_locale. The member view does not return this.
  locale: text('locale'),
}, table => [
  check('user_locale', sql`${table.locale} is null or ${table.locale} in ('hr', 'en')`),
])

export const session = authSchema.table('session', {
  id: text('id').primaryKey(),
  expiresAt: instant('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('active_organization_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const account = authSchema.table('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: instant('access_token_expires_at'),
  refreshTokenExpiresAt: instant('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const verification = authSchema.table('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: instant('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const organization = authSchema.table('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: createdAt(),
  metadata: text('metadata'),
})

export const member = authSchema.table('member', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: createdAt(),
})

export const invitation = authSchema.table('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull(),
  expiresAt: instant('expires_at').notNull(),
  createdAt: createdAt(),
  inviterId: text('inviter_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})
