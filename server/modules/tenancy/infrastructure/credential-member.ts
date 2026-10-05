import type { QueryResult, QueryResultRow } from 'pg'
import type { TenantRole } from '../../../../shared'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'

/**
 * A Pool and a PoolClient both match, so a suite can pass the pool it
 * already holds. The connecting wrappers open a short-lived pool for a
 * caller that only has the auth URL, such as the Playwright seed.
 */
export interface CredentialDb {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>
}

export interface CredentialUserInput {
  readonly email: string
  readonly name: string
  readonly password: string
}

/**
 * The credential rows the operator script writes, without a membership.
 * Sign-in then has no Tenant, which is the 403 shell.
 */
export async function insertCredentialUser(db: CredentialDb, input: CredentialUserInput): Promise<string> {
  const userId = crypto.randomUUID()
  await db.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, input.name, input.email],
  )
  await db.query(
    `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), userId, await hashPassword(input.password)],
  )
  return userId
}

/** One membership row. The role is the Tenant role, not a Better Auth owner. */
export async function insertMembership(db: CredentialDb, tenantId: string, userId: string, role: TenantRole): Promise<void> {
  await db.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), tenantId, userId, role],
  )
}

export async function insertCredentialMember(
  db: CredentialDb,
  tenantId: string,
  input: CredentialUserInput & { readonly role: TenantRole },
): Promise<string> {
  const userId = await insertCredentialUser(db, input)
  await insertMembership(db, tenantId, userId, input.role)
  return userId
}

async function usingAuth<T>(authDatabaseUrl: string, run: (db: CredentialDb) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: authDatabaseUrl, max: 1 })
  try {
    return await run(pool)
  }
  finally {
    await pool.end()
  }
}

/** Opens the auth connection itself. The Playwright seed has no shared pool. */
export function insertCredentialUserConnecting(authDatabaseUrl: string, input: CredentialUserInput): Promise<string> {
  return usingAuth(authDatabaseUrl, db => insertCredentialUser(db, input))
}

/** Opens the auth connection itself. The Playwright seed has no shared pool. */
export function insertCredentialMemberConnecting(
  authDatabaseUrl: string,
  tenantId: string,
  input: CredentialUserInput & { readonly role: TenantRole },
): Promise<string> {
  return usingAuth(authDatabaseUrl, db => insertCredentialMember(db, tenantId, input))
}
