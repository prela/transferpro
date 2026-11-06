import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { loadAppEnv, openTenantSession } from '../../../core'
import { readDecryptedInvoicingToken } from './settings'

/**
 * Decrypts this Tenant's token in a short session and commits before the
 * caller talks to the tool. The plaintext is the return value only.
 */

let pool: pg.Pool | undefined
let database: ReturnType<typeof drizzle> | undefined

function tokenDatabase(): ReturnType<typeof drizzle> {
  if (!database) {
    pool = new pg.Pool({ connectionString: loadAppEnv().DATABASE_URL, max: 2 })
    database = drizzle(pool)
  }
  return database
}

export async function openDecryptedInvoicingToken(tenantId: string): Promise<string> {
  return tokenDatabase().transaction(transaction =>
    openTenantSession(transaction, { tenantId }, () => readDecryptedInvoicingToken(transaction, tenantId)),
  )
}
