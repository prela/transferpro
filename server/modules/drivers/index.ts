/**
 * Drivers module. Callers import this file, not the infrastructure files.
 * A Driver is a person the office can assign. The record can exist with no
 * account. Rides will point at a Driver later; this module does not import them.
 */
export { createDriver, DriverNotFoundError, listDrivers, updateDriver } from './infrastructure/driver-access'
