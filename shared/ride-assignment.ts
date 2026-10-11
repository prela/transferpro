import { z } from 'zod'
import { RIDE_STATES, rideStateSchema } from './transfer'

/**
 * The only strings an audit row may store for an assignment.
 * The must-accept value stays on the Ride. A plate, a phone, or a name
 * cannot sit in this list.
 */
export const RIDE_ASSIGNMENT_FIELDS = ['state', 'driverId', 'vehicleId', 'mustAccept'] as const

export const rideAssignmentFieldSchema = z.enum(RIDE_ASSIGNMENT_FIELDS)

export type RideAssignmentField = z.infer<typeof rideAssignmentFieldSchema>

/**
 * POST /api/rides/:id/assign. The ride id is the path. Both ids are required:
 * a Driver without a Vehicle, or a Vehicle without a Driver, is not an assignment
 * (ADR-0005). An unknown key is refused.
 */
export const assignRideSchema = z.strictObject({
  rideId: z.uuid(),
  driverId: z.uuid(),
  vehicleId: z.uuid(),
  confirm: z.boolean().optional(),
})

export interface AssignRide {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
  /** Set only after a 409 `ride_overlap`. A tight gap does not use this. */
  readonly confirm?: boolean
}

/** The body was not an assignment. Nothing is written. */
export class AssignRideInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'AssignRideInputError'
  }
}

/**
 * Accepts an assignment. Any other body throws first, so the caller does not
 * open a session. A missing id is the same failure as a body that names only one.
 */
export function parseAssignRide(raw: unknown): AssignRide {
  const parsed = assignRideSchema.safeParse(raw)
  if (!parsed.success)
    throw new AssignRideInputError()
  return parsed.data
}

/**
 * GET /api/rides/:id/roster-vehicle. The ride id is the path. The Driver is
 * the query. Both are required before a session opens.
 */
export function parseRosterVehicleRead(rideId: unknown, driverId: unknown): { rideId: string, driverId: string } {
  const parsed = z.strictObject({
    rideId: z.uuid(),
    driverId: z.uuid(),
  }).safeParse({ rideId, driverId })
  if (!parsed.success)
    throw new AssignRideInputError()
  return parsed.data
}

/** The pre-fill. Null means the roster has no Vehicle for that Driver that day, or the Vehicle is archived. */
export const rosterVehicleSuggestionSchema = z.object({
  vehicleId: z.uuid().nullable(),
})

export type RosterVehicleSuggestion = z.infer<typeof rosterVehicleSuggestionSchema>

/**
 * Only `unassigned` may move to `assigned`. Every other state is a conflict,
 * and the caller writes nothing. The database statement still guards with
 * `where state = 'unassigned'`, so two assigns cannot both pass.
 */
export function assignTransitionAllowed(state: string): boolean {
  const parsed = rideStateSchema.safeParse(state)
  if (!parsed.success)
    return false
  return parsed.data === 'unassigned'
}

/** Every ADR-0005 state except `unassigned` refuses assignment. */
export const ASSIGNMENT_REFUSED_STATES = RIDE_STATES.filter(state => state !== 'unassigned')

/**
 * The only field a vehicle-only change may name. The state and the copied
 * flag stay on the Ride, so they are not in this list.
 */
export const RIDE_VEHICLE_CHANGE_FIELDS = ['vehicleId'] as const

export const rideVehicleChangeFieldSchema = z.enum(RIDE_VEHICLE_CHANGE_FIELDS)

/**
 * POST /api/rides/:id/vehicle. The ride id is the path. The Vehicle is
 * required. A Driver is not a field: this command keeps the one already
 * on the Ride. An unknown key is refused.
 */
export const changeRideVehicleSchema = z.strictObject({
  rideId: z.uuid(),
  vehicleId: z.uuid(),
  confirm: z.boolean().optional(),
})

export interface ChangeRideVehicle {
  readonly rideId: string
  readonly vehicleId: string
  /** Set only after a 409 `ride_overlap`. A tight gap does not use this. */
  readonly confirm?: boolean
}

/**
 * POST /api/rides/:id/reassign. Both ids are required. The same Driver is
 * not a reassignment: that is a vehicle change. An unknown key is refused.
 */
export const reassignRideSchema = z.strictObject({
  rideId: z.uuid(),
  driverId: z.uuid(),
  vehicleId: z.uuid(),
  confirm: z.boolean().optional(),
})

export interface ReassignRide {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
  /** Set only after a 409 `ride_overlap`. A tight gap does not use this. */
  readonly confirm?: boolean
}

/** The body was not one of these commands. Nothing is written. */
export class RideCommandInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'RideCommandInputError'
  }
}

/** Accepts a vehicle change. Any other body throws first, so the caller does not open a session. */
export function parseChangeRideVehicle(raw: unknown): ChangeRideVehicle {
  const parsed = changeRideVehicleSchema.safeParse(raw)
  if (!parsed.success)
    throw new RideCommandInputError()
  return parsed.data
}

/**
 * Accepts a clear. The path is the Ride. The body is empty. Any key throws
 * first, so the caller does not open a session. No body is the same empty object.
 */
export function parseClearRide(rideId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(rideId)
  const payload = body === undefined ? { success: true as const } : z.strictObject({}).safeParse(body)
  if (!id.success || !payload.success)
    throw new RideCommandInputError()
  return id.data
}

/** Accepts a reassignment. A body that names only one id throws first. */
export function parseReassignRide(raw: unknown): ReassignRide {
  const parsed = reassignRideSchema.safeParse(raw)
  if (!parsed.success)
    throw new RideCommandInputError()
  return parsed.data
}

/**
 * A vehicle change, a clear, and a reassignment start from `assigned` or
 * `accepted`. Every other state writes nothing. The database statement
 * still guards those two states.
 */
export function rideChangeAllowed(state: string): boolean {
  const parsed = rideStateSchema.safeParse(state)
  if (!parsed.success)
    return false
  return parsed.data === 'assigned' || parsed.data === 'accepted'
}
