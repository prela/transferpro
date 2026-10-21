import type { UnavailabilityField, UnavailabilityResource } from '../../../../shared'
import type { CapacityMinutes, OccupyingRide } from '../domain/occupation'
import type { UnavailabilityWindow, WindowTimes } from '../domain/unavailability'

export type { CapacityMinutes, OccupyingRide } from '../domain/occupation'
export type { UnavailabilityWindow, WindowTimes } from '../domain/unavailability'

/**
 * The Rides that occupy one Driver or one Vehicle, at any time. `rideId`
 * is the Ride being judged and is left out of the answer. A command asks
 * this for the Driver and the Vehicle it is about to write.
 */
export interface RideOccupationQuery {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
}

/** Whose Rides a range question asks about. A Partner id matches handed-off Rides only. */
export interface OccupationResources {
  readonly driverIds: readonly string[]
  readonly vehicleIds: readonly string[]
  readonly partnerIds: readonly string[]
}

/**
 * The Rides of these resources, or of the whole Tenant, that touch the
 * half-open range `[from, to)`: the pickup or the landing falls inside it,
 * or the pickup is before it and the landing at or after its end.
 * `leaveOut` is a Ride that is never in the answer.
 */
export interface RangeOccupationQuery {
  readonly of: OccupationResources | 'tenant'
  readonly from: Date
  readonly to: Date
  readonly leaveOut?: string
}

/**
 * Who is taken (ADR-0034, ADR-0036). Capacity defines it; the transfers
 * infrastructure implements it, so capacity never reads a Ride table.
 * Both answers hold assigned, accepted, and handed-off Rides.
 */
export interface OccupationPort {
  ridesOf: (query: RideOccupationQuery) => Promise<readonly OccupyingRide[]>
  ridesDuring: (query: RangeOccupationQuery) => Promise<readonly OccupyingRide[]>
}

/** Reads the Tenant's transfer duration and relocation gap from tenancy. */
export type CapacityMinutesReader = () => Promise<CapacityMinutes>

/**
 * The live windows of these Drivers, Vehicles, and Partners that share an
 * instant with the half-open range `[from, to)`. A removed window is never
 * in the answer.
 */
export interface UnavailabilityQuery {
  readonly driverIds: readonly string[]
  readonly vehicleIds: readonly string[]
  readonly partnerIds: readonly string[]
  readonly from: Date
  readonly to: Date
}

/** Reads the unavailability windows. Capacity owns the table, so its own infrastructure implements this. */
export type UnavailabilityReader = (query: UnavailabilityQuery) => Promise<readonly UnavailabilityWindow[]>

/** Everything a capacity application service reads through. */
export interface CapacityPorts {
  readonly occupation: OccupationPort
  readonly minutes: CapacityMinutesReader
  readonly windows: UnavailabilityReader
}

/** A new window: exactly one of the three ids is set. */
export interface UnavailabilityRecord extends WindowTimes {
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly partnerId: string | null
}

/**
 * Writes and reads of the window table on the caller's tenant transaction.
 * `lockLive` takes `for update` on a window that is not removed, or answers
 * null. There is no delete here: only the retention job deletes.
 */
export interface UnavailabilityStore {
  insert: (record: UnavailabilityRecord) => Promise<UnavailabilityWindow>
  lockLive: (windowId: string) => Promise<UnavailabilityWindow | null>
  update: (windowId: string, times: WindowTimes) => Promise<UnavailabilityWindow>
  markRemoved: (windowId: string) => Promise<void>
  liveOf: (resource: UnavailabilityResource) => Promise<readonly UnavailabilityWindow[]>
  liveDuring: (from: Date, to: Date) => Promise<readonly UnavailabilityWindow[]>
}

/** Whether the Driver or Vehicle exists in this Tenant, and whether it is archived. Read without a lock. */
export type ResourcePresence = 'active' | 'archived' | 'missing'
export type ResourcePresenceReader = (resource: UnavailabilityResource) => Promise<ResourcePresence>

/**
 * What the audit log keeps about a window: ids and field names. It never
 * holds the instants (ADR-0034), so the log shows that a window changed,
 * not when someone was away.
 */
export interface UnavailabilityAuditFact {
  readonly action: 'unavailability.added' | 'unavailability.changed' | 'unavailability.removed'
  readonly windowId: string
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly partnerId: string | null
  readonly fields: readonly UnavailabilityField[]
}

/** Active Partner ids of this Tenant, in the partners module's order. */
export type ActivePartnerReader = () => Promise<readonly string[]>

/**
 * The window commands read and write through these. `lock` is the Tenant
 * capacity lock; `audit` appends one entry on the same transaction.
 * Transfers wires the audit and the occupation, since capacity imports neither.
 */
export interface UnavailabilityPorts extends CapacityPorts {
  readonly store: UnavailabilityStore
  readonly presence: ResourcePresenceReader
  readonly lock: () => Promise<void>
  readonly audit: (fact: UnavailabilityAuditFact) => Promise<void>
}
