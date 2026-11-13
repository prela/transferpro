import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { parseRecordPartnerConfirmation, RIDE_PARTNER_CONFIRMATION_FIELDS, rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { TenantAccessError, withOfficeWrite } from '../../tenancy'
import { RideNotFoundError } from './assign'
import { claimTransferVersion, refuseStaleVersion } from './transfer-version'

/**
 * The Ride is not a handoff waiting on Partner confirmation: already
 * confirmed, taken back, never handed off, or closed. Nothing was written
 * (ADR-0062). There is no `transfer_closed` step.
 */
export class RideNotAwaitingPartnerConfirmationError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_awaiting_partner_confirmation'

  constructor() {
    super('Conflict')
    this.name = 'RideNotAwaitingPartnerConfirmationError'
  }
}

const recordedSchema = z.object({
  rideId: z.uuid(),
  partnerConfirmed: z.literal(true),
  version: z.number().int().nonnegative(),
})

export type RecordedPartnerConfirmation = z.infer<typeof recordedSchema>

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: rideStateSchema,
    version: z.number().int(),
    partnerId: z.uuid().nullable(),
    partnerConfirmed: z.boolean(),
  })),
})

const storedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
  })),
})

/**
 * Record that the Partner agreed to a handed-off Ride. The body is parsed
 * first. A driver is 403. The version is required and changes once. The
 * command takes no Tenant capacity lock and does not read the Partner row,
 * so an archived Partner can still be confirmed and an unavailable Partner
 * is not refused (ADR-0062).
 */
export async function recordPartnerConfirmation(
  headers: Headers,
  rawRideId: unknown,
  rawBody: unknown,
): Promise<RecordedPartnerConfirmation> {
  return withOfficeWrite(headers, rawBody, body => parseRecordPartnerConfirmation(rawRideId, body), async ({ actor, transaction }, input) => {
    officeOnly(actor.role)
    return recordPartnerConfirmationForOffice(transaction, actor.userId, input.rideId, input.version)
  })
}

export async function recordPartnerConfirmationForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  version: number,
): Promise<RecordedPartnerConfirmation> {
  const current = await lockRide(transaction, rideId)
  if (!current)
    throw new RideNotFoundError()
  // A mismatch is the form the office still holds. The state check is next,
  // so a second recording from that form is `stale_save`, not the state refusal.
  refuseStaleVersion(current.version, version)
  const partnerId = current.partnerId
  if (current.state !== 'handed_off' || current.partnerConfirmed || partnerId === null)
    throw new RideNotAwaitingPartnerConfirmationError()

  await claimTransferVersion(transaction, current.transferId, version, actorUserId, 'Partner confirmation failed')
  const updated = storedRows.parse(await runStep(transaction, sql`
    update app.rides
    set partner_confirmed = true
    where id = ${rideId}
      and state = 'handed_off'
      and partner_confirmed = false
      and partner_id = ${partnerId}
    returning id
  `)).rows[0]
  if (!updated)
    throw new RideNotAwaitingPartnerConfirmationError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.partner_confirmed',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      partnerId,
      fields: [RIDE_PARTNER_CONFIRMATION_FIELDS[0]],
    },
  }), 'Partner confirmation failed')
  return recordedSchema.parse({
    rideId: updated.id,
    partnerConfirmed: true,
    version: version + 1,
  })
}

function officeOnly(role: string): void {
  // Only the office speaks for a Partner. A driver is 403 (ADR-0062).
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * The Transfer is the outer table, the same order as a handoff, so the two
 * commands cannot deadlock. `partner_id` is the Ride column. The Partner
 * table is not read.
 */
async function lockRide(transaction: TenantTransaction, rideId: string) {
  return lockedRows.parse(await runStep(transaction, sql`
    select r.id,
           r.transfer_id as "transferId",
           r.state,
           t.version,
           r.partner_id as "partnerId",
           r.partner_confirmed as "partnerConfirmed"
    from app.transfers as t
    join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
    where r.id = ${rideId}
    for update of t, r
  `)).rows[0]
}

function runStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Partner confirmation failed')
}
