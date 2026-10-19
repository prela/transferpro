/**
 * Capacity module (ADR-0034). Callers import this file, not the tier files.
 * Capacity decides whether a Driver or a Vehicle is taken at a given time.
 * It is about time, not seats. The occupied window and the judge are its
 * contract in `shared/capacity.ts`, which the browser pre-check, the board
 * warnings, and the occupation strip use unchanged (ADR-0029).
 *
 * Capacity never reads a Ride table. It asks the occupation port, which
 * the transfers infrastructure implements, and reads the transfer duration
 * and the relocation gap from tenancy. Assign, a Vehicle change, a
 * reassignment, and a judged Transfer correction take the Tenant capacity
 * lock and then call `judgeRideCapacity`; transfers throws
 * `RideOverlapError` from the verdict unless the office confirmed it.
 * The board reads its neighbours through `readBoardOccupation`.
 *
 * Capacity owns the unavailability windows (Nedostupnost) of Drivers and
 * Vehicles: their table, the window commands, the board's unavailability
 * warning through `readBoardUnavailability`, and the daily retention job.
 * The verdict lists the unavailable resources; transfers throws
 * `RideUnavailableError` from it unless confirmed. Transfers passes its
 * occupation adapter and the audit append into `unavailabilityPorts`.
 *
 * Only transfers imports this module. Capacity may import tenancy, drivers,
 * and vehicles, and never imports transfers (ADR-0034, ADR-0036).
 */
export { readBoardOccupation } from './application/board'
export type { BoardOccupyingRide } from './application/board'
export { readBoardUnavailability } from './application/board-unavailability'
export type { BoardUnavailabilityRide } from './application/board-unavailability'
export { correctionMovesWindow } from './application/correction'
export { judgeRideCapacity } from './application/judge-ride'
export type { CapacityMinutes, CapacityMinutesReader, CapacityPorts, OccupationPort, OccupationResources, OccupyingRide, RangeOccupationQuery, RideOccupationQuery, UnavailabilityAuditFact, UnavailabilityPorts, UnavailabilityReader } from './application/ports'
export { changeUnavailability, listUnavailabilityDuring, listUnavailabilityOf, recordUnavailability, removeUnavailability } from './application/unavailability'
export { RideOverlapError, RideUnavailableError, UnavailabilityArchivedError, UnavailabilityNotFoundError } from './domain/errors'
export type { CapacityVerdict } from './domain/occupation'
export type { RideTimes } from './domain/window'
export { lockTenantCapacity } from './infrastructure/lock'
export { capacityPorts, tenantCapacityMinutes, unavailabilityPorts } from './infrastructure/ports'
export { startUnavailabilityRetention } from './infrastructure/retention'
