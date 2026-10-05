export { RosterDriverTakenError, RosterNotFoundError, RosterVehicleArchivedError, RosterVehicleTakenError, vehicleIdForDriverOnDate } from './infrastructure/roster'
/**
 * Roster module. One row is one Driver's Vehicle for one calendar date.
 * Callers import this file, not the infrastructure files.
 * `vehicleIdForDriverOnDate` is what a later Ride assignment (#19) reads
 * inside its own tenant transaction. It may still store a different Vehicle
 * on that one Ride. Setting the roster does not write a Ride: this module
 * has no ride table and does not import transfers.
 * Drivers and Vehicles are reached through their index files, by id.
 */
export { listRosterDay, setRosterDay } from './infrastructure/roster-access'
