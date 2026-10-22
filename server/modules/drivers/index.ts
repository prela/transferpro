/**
 * Drivers module. Callers import this file, not the infrastructure files.
 * A Driver is a person the office can assign. The record can exist with no
 * account. This module does not import Rides (ADR-0018).
 */
export { archiveDriver, createDriver, DriverArchivedError, DriverNotFoundError, listDrivers, loadDriverLinkedToMember, loadDrivers, unarchiveDriver, updateDriver } from './infrastructure/driver-access'
export { driverAssignState, driverIsInTenant, driverPresence, loadActiveDriverIds, loadDriverDocumentExpiry } from './infrastructure/drivers'
export type { DriverAssignState, DriverDocumentExpiry, DriverPresence } from './infrastructure/drivers'
