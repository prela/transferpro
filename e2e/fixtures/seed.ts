import process from 'node:process'
import { createTenant } from '../../server/modules/tenancy'
import { insertCredentialMemberConnecting, insertCredentialUserConnecting } from '../../server/modules/tenancy/testing'

/** Shared by every seeded account. Inside the auth password bounds. */
export const memberPassword = 'e2e-member-password'

export interface SeededTenant {
  readonly tenantId: string
  readonly name: string
  readonly adminEmail: string
  readonly adminName: string
  readonly password: string
}

export interface SeededMember {
  readonly email: string
  readonly name: string
  readonly password: string
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

function id(): string {
  return crypto.randomUUID()
}

/** One Tenant and its admin. The slug and the email are unique because the audit log is append-only. */
export async function seedTenant(label: string): Promise<SeededTenant> {
  const suffix = id()
  const name = `E2E ${label} ${suffix.slice(0, 8)}`
  const adminEmail = `e2e-${label}-${suffix}@example.test`
  const adminName = `Admin ${label}`
  const created = await createTenant({
    name,
    slug: `e2e-${label}-${suffix}`,
    adminEmail,
    adminName,
    password: memberPassword,
    authDatabaseUrl: required('AUTH_DATABASE_URL'),
    migrateDatabaseUrl: required('DATABASE_MIGRATE_URL'),
  })
  return {
    tenantId: created.tenantId,
    name,
    adminEmail,
    adminName,
    password: memberPassword,
  }
}

/** A credential member, using the same insert as the member-management RLS tests. */
export async function seedMember(tenantId: string, role: 'admin' | 'dispatcher' | 'driver', label: string): Promise<SeededMember> {
  const suffix = id()
  // The label may contain č or š. The browser rejects those in an email field.
  const email = `e2e-${role}-${suffix}@example.test`
  const name = `${label} ${suffix.slice(0, 8)}`
  await insertCredentialMemberConnecting(required('AUTH_DATABASE_URL'), tenantId, {
    email,
    name,
    password: memberPassword,
    role,
  })
  return { email, name, password: memberPassword }
}

/** A credential user with no membership. Sign-in then shows the no-access message. */
export async function seedUserWithoutMembership(label: string): Promise<SeededMember> {
  const suffix = id()
  const email = `e2e-none-${label}-${suffix}@example.test`
  const name = `None ${suffix.slice(0, 8)}`
  await insertCredentialUserConnecting(required('AUTH_DATABASE_URL'), {
    email,
    name,
    password: memberPassword,
  })
  return { email, name, password: memberPassword }
}
