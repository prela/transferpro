import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'

/**
 * The form's version is not the stored one. Nothing is written and no audit
 * entry is appended. The body stays the ADR-0012 shape: this name is not a
 * person's name. ADR-0046.
 */
export class StaleSaveError extends Error {
  readonly statusCode = 409
  readonly code = 'stale_save'

  constructor() {
    super('Conflict')
    this.name = 'StaleSaveError'
  }
}

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: rideStateSchema,
    version: z.number().int(),
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
  })),
})

export type LockedTransferRide = z.infer<typeof lockedRows>['rows'][number]

/**
 * Lock the Transfer and its Ride. The Transfer row is the outer table, the
 * same order a correction uses, so the two commands cannot deadlock. The
 * version is whatever a concurrent save has already committed.
 */
export async function lockTransferRide(
  transaction: TenantTransaction,
  rideId: string,
  failure: string,
): Promise<LockedTransferRide | undefined> {
  return lockedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    select r.id,
           r.transfer_id as "transferId",
           r.state,
           t.version,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.must_accept as "mustAccept"
    from app.transfers as t
    join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
    where r.id = ${rideId}
    for update of t, r
  `), failure)).rows[0]
}

/** A mismatch is refused before any write, including a body that would change nothing. */
export function refuseStaleVersion(stored: number, opened: number): void {
  if (stored !== opened)
    throw new StaleSaveError()
}

const claimedRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/**
 * Compare-and-swap the version. The caller holds the Transfer row and writes
 * the Ride on this same transaction, after this update. Zero rows rolls that
 * write back: the opened version lost. The audit entry is appended only
 * after this returns. ADR-0046.
 */
export async function claimTransferVersion(
  transaction: TenantTransaction,
  transferId: string,
  expectedVersion: number,
  actorUserId: string,
  failure: string,
): Promise<void> {
  const claimed = claimedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.transfers
    set version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where id = ${transferId}
      and version = ${expectedVersion}
    returning id
  `), failure))
  if (!claimed.rows[0])
    throw new StaleSaveError()
}
