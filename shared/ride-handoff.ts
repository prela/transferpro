import { z } from 'zod'
import { RideCommandInputError } from './ride-assignment'
import { rideSchema } from './transfer'
import { workOrderNoticeSchema } from './work-order'

/**
 * A handoff from `unassigned` writes the state and the Partner. The Ride
 * had no Driver and no Vehicle, so those ids are not on the entry (ADR-0048).
 */
export const RIDE_HANDOFF_OPEN_FIELDS = ['state', 'partnerId'] as const

/**
 * A handoff from `assigned` or `accepted` also clears the Driver, the
 * Vehicle, and the copied flag. The entry names those fields and keeps
 * the ids that were cleared. A plate or a phone is not a field.
 */
export const RIDE_HANDOFF_CLEAR_FIELDS = ['state', 'partnerId', 'driverId', 'vehicleId', 'mustAccept'] as const

/** A change of Partner names the new Partner only. The previous one is not a key. */
export const RIDE_PARTNER_CHANGED_FIELDS = ['partnerId'] as const

/** Taking the Ride back clears the Partner and returns it to `unassigned`. */
export const RIDE_TAKEN_BACK_FIELDS = ['state', 'partnerId'] as const

/** ADR-0048. The office may hand off from these three states only. */
export function canHandOffRide(state: string): boolean {
  return state === 'unassigned' || state === 'assigned' || state === 'accepted'
}

/** A Partner change and a take-back start from `handed_off` only. */
export function canChangeHandedOffPartner(state: string): boolean {
  return state === 'handed_off'
}

/** Taking the Ride back is the same source state as a Partner change. */
export function canTakeBackHandedOffRide(state: string): boolean {
  return state === 'handed_off'
}

/**
 * The office may close a handed-off Ride as done, a No-show, or cancelled
 * at any time. The Driver may not. The copied flag does not apply: there
 * is no Driver (ADR-0048).
 */
export function canCloseHandedOffRide(state: string): boolean {
  return state === 'handed_off'
}

const partnerVersionBody = z.strictObject({
  partnerId: z.uuid(),
  /** The Transfer version the form was opened with. One version covers the Ride. */
  version: z.number().int().nonnegative(),
})

const versionBody = z.strictObject({
  version: z.number().int().nonnegative(),
})

export interface HandOffRideInput {
  readonly rideId: string
  readonly partnerId: string
  readonly version: number
}

/**
 * POST /api/rides/:id/hand-off. The path is the Ride. The body is the
 * Partner and the version. Any other key, or a missing version, throws
 * first, so the caller does not open a session.
 */
export function parseHandOffRide(rideId: unknown, body: unknown): HandOffRideInput {
  return parsePartnerCommand(rideId, body)
}

/** POST /api/rides/:id/partner. The same body as a handoff. The Ride must already be handed off. */
export function parseChangeRidePartner(rideId: unknown, body: unknown): HandOffRideInput {
  return parsePartnerCommand(rideId, body)
}

/** POST /api/rides/:id/take-back. The body is only the version. */
export function parseTakeBackRide(rideId: unknown, body: unknown): { rideId: string, version: number } {
  const id = z.uuid().safeParse(rideId)
  const payload = versionBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new RideCommandInputError()
  return { rideId: id.data, version: payload.data.version }
}

function parsePartnerCommand(rideId: unknown, body: unknown): HandOffRideInput {
  const id = z.uuid().safeParse(rideId)
  const payload = partnerVersionBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new RideCommandInputError()
  return { rideId: id.data, partnerId: payload.data.partnerId, version: payload.data.version }
}

/**
 * The Ride after a handoff, a Partner change, or a take-back.
 * `partnerId` is set while the Ride is `handed_off`, and null after a
 * take-back. The Driver and the Vehicle are null in both cases.
 */
export const handedOffRideSchema = rideSchema.extend({
  partnerId: z.uuid().nullable(),
})

/**
 * `workOrders` is empty when the Ride had no Driver. A handoff from
 * `assigned` or `accepted` has one `no_longer_yours` notice. A Partner
 * change and a take-back send nothing. The address is not on this object.
 */
export const handedOffRideResultSchema = z.object({
  ride: handedOffRideSchema,
  workOrders: z.array(workOrderNoticeSchema),
})

export type HandedOffRideResult = z.infer<typeof handedOffRideResultSchema>
