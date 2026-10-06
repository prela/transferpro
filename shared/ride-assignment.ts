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
})

export interface AssignRide {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
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
