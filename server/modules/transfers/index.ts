/**
 * Transfers module. Callers import this file, not the infrastructure files.
 * A Transfer is the booking. Creating one creates exactly one unassigned Ride.
 * Assignment gives that Ride a Driver and a Vehicle together.
 * The Driver accepts that Ride when the copied flag is on.
 * Clients, Locations, Drivers, Vehicles, and the roster are reached through
 * their index files, by id. Those modules do not import this one (ADR-0018).
 */
export { acceptRide, AcceptRideInputError, RideNotAcceptableError } from './infrastructure/accept'
export { RideNotFoundError, RideNotUnassignedError, RideVehicleArchivedError } from './infrastructure/assign'
export { assignRide, rosterVehicleForRide } from './infrastructure/assign-access'
export { listUpcomingRides } from './infrastructure/driver-ride-access'
export { createTransfer, listTransferDay } from './infrastructure/transfer-access'
