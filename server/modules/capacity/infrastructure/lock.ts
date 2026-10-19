import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { hideDatabaseError } from '../../../core/index'

/**
 * First key of the two-key advisory lock. Postgres keeps two-key locks
 * apart from one-key locks, so this never meets the member lock, which
 * is `pg_advisory_xact_lock(hashtext(organizationId))` (ADR-0014).
 */
const CAPACITY_LOCK_SPACE = 34

/**
 * Take the Tenant capacity lock (ADR-0034) on this transaction. The Tenant
 * is the session's `app.tenant_id`, never a request value; the uuid cast
 * fails, rather than locking nothing, when the session has no Tenant.
 * It waits with no timeout and is released at commit or rollback. Two
 * capacity writes of one Tenant run one after the other. Another Tenant's
 * key differs, so two Tenants never wait on each other.
 *
 * Lock order. The caller has already locked its Transfer and Ride rows and
 * made every refusal that needs no other row: role, input, `stale_save`,
 * and state. It takes this lock next, and only after that reads a Driver,
 * a Vehicle, or another Ride. Occupation is read without row locks, so no
 * lock cycle can form with this one, and the second of two concurrent
 * commands sees the first.
 */
export async function lockTenantCapacity(transaction: TenantTransaction): Promise<void> {
  await hideDatabaseError(() => transaction.execute(sql`
    select pg_advisory_xact_lock(${sql.raw(String(CAPACITY_LOCK_SPACE))}, hashtext(current_setting('app.tenant_id')::uuid::text))
  `), 'Ride capacity lock failed')
}
