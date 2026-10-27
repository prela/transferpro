import type { TransferGroup } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { officeGroupPassengerCount, rideStateSchema, transferGroupSchema, TransferInputError } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { TransferNotFoundError } from './transfer-errors'
import { toInstant } from './transfers'

/**
 * Reading a group is office work. A driver is refused before a Transfer
 * is read. The list is this function, not the caller.
 */
const TRANSFER_GROUP_ROLES = ['admin', 'dispatcher'] as const

function officeOnly(role: string): void {
  if ((TRANSFER_GROUP_ROLES as readonly string[]).includes(role))
    return
  throw new TenantAccessError(403)
}

const anchorSchema = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    mainTransferId: z.uuid().nullable(),
    groupPassengerCount: z.number().int().nullable(),
  })),
})

const memberRowSchema = z.object({
  rideId: z.uuid(),
  transferId: z.uuid(),
  guestName: z.string(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  partnerId: z.uuid().nullable(),
  mainTransferId: z.uuid().nullable(),
  groupPassengerCount: z.number().int().nullable(),
  passengerCount: z.number().int(),
})

/**
 * Every member of the group this Transfer belongs to. The main Transfer
 * comes first. Extra vehicles follow by their own pickup, then by id.
 * A pickup is never taken from the main Transfer and written onto a member.
 * An ordinary Transfer, one with no link and no stored group count and no
 * extra vehicle, is an empty list. A missing id, including another Tenant's,
 * is not found. Nothing is written.
 */
async function loadTransferGroup(transaction: TenantTransaction, transferId: string): Promise<TransferGroup> {
  const anchor = anchorSchema.parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select id, link as "mainTransferId", group_passenger_count as "groupPassengerCount"
      from app.transfers
      where id = ${transferId}
    `),
    'Transfer group failed',
  )).rows[0]
  if (!anchor)
    throw new TransferNotFoundError()

  const mainId = anchor.mainTransferId ?? anchor.id
  const selected = z.object({ rows: z.array(memberRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        t.id as "transferId",
        t.guest_name as "guestName",
        t.pickup_at as "pickupAt",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        r.state,
        r.driver_id as "driverId",
        r.partner_id as "partnerId",
        t.link as "mainTransferId",
        t.group_passenger_count as "groupPassengerCount",
        t.passenger_count as "passengerCount"
      from app.transfers as t
      join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
      where t.tenant_id = (select tenant_id from app.transfers where id = ${mainId})
        and (t.id = ${mainId} or t.link = ${mainId})
      order by (t.link is null) desc, t.pickup_at, t.id
    `),
    'Transfer group failed',
  ))

  const grouped = anchor.mainTransferId !== null
    || anchor.groupPassengerCount !== null
    || selected.rows.some(row => row.mainTransferId !== null)
  if (!grouped)
    return transferGroupSchema.parse({ members: [] })

  return transferGroupSchema.parse({
    members: selected.rows.map(row => ({
      rideId: row.rideId,
      transferId: row.transferId,
      guestName: row.guestName,
      pickupAt: toInstant(row.pickupAt),
      startLocationId: row.startLocationId,
      endLocationId: row.endLocationId,
      state: row.state,
      driverId: row.driverId,
      partnerId: row.partnerId,
      mainTransferId: row.mainTransferId,
      groupPassengerCount: officeGroupPassengerCount(row.mainTransferId, row.groupPassengerCount, row.passengerCount),
    })),
  })
}

/**
 * The group of one Transfer, on every day its members pick up. The id is
 * parsed first, so a bad id never opens a session. Admin and dispatcher
 * may read it. A driver is 403. No session is 401. Another Tenant is 404.
 * The read writes no audit entry.
 */
export async function readTransferGroup(headers: Headers, rawId: unknown): Promise<TransferGroup> {
  const id = z.uuid().safeParse(rawId)
  if (!id.success)
    throw new TransferInputError()
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    try {
      return await loadTransferGroup(transaction, id.data)
    }
    catch (error) {
      if (error instanceof TenantAccessError || error instanceof TransferNotFoundError)
        throw error
      throw new Error('Transfer group failed')
    }
  })
}
