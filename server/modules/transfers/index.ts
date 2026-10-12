/**
 * Transfers module. Callers import this file, not the infrastructure files.
 * A Transfer is the booking. Creating one creates exactly one unassigned Ride.
 * Assignment gives that Ride a Driver and a Vehicle together.
 * The Driver accepts that Ride when the copied flag is on.
 * The office records that same acceptance after confirming by phone.
 * The Driver or the office marks the Ride done: from `assigned` when the
 * copied flag is off, and only from `accepted` when the flag is on.
 * The office can change only the Vehicle, clear the Ride, or reassign it.
 * Each of those mails a work order after the Ride is saved.
 * Clients, Locations, Drivers, Vehicles, and the roster are reached through
 * their index files, by id. Those modules do not import this one (ADR-0018).
 */
export { acceptRide, acceptRideByPhone, AcceptRideInputError, RideNotAcceptableError } from './infrastructure/accept'
export { RideNotFoundError, RideNotUnassignedError, RideVehicleArchivedError } from './infrastructure/assign'
export { assignRide, rosterVehicleForRide } from './infrastructure/assign-access'
export { markRideDone, MarkRideDoneInputError, RideNotFinishableError } from './infrastructure/done'
export { listUpcomingRides } from './infrastructure/driver-ride-access'
export { askFlightLandings, LandingTimeClosedError, LandingTimeInFutureError, recordLandingTime, refreshFlightLandings } from './infrastructure/flight-landing'
export { startFlightLandingWorker } from './infrastructure/flight-landing-worker'
export { readOfficeHome } from './infrastructure/office-home-access'
export { changeVehicle, clearRide, reassignRide, RideNotOpenError, RideSameDriverError, RideVehicleUnchangedError } from './infrastructure/ride-change'
export { RideOverlapError } from './infrastructure/ride-schedule'
export { createTransfer, listTransferDay } from './infrastructure/transfer-access'
