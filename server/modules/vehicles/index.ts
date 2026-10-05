/**
 * Vehicles module. Callers import this file, not the infrastructure files.
 * A Vehicle is a vehicle the office can assign, not a registration plate.
 * The record can be archived.
 * Rides will point at a Vehicle later; this module does not import them.
 */
export { archiveVehicle, createVehicle, listVehicles, updateVehicle, VehicleArchivedError, VehicleArchivedPlateError, VehicleNotFoundError, VehiclePlateTakenError } from './infrastructure/vehicle-access'
