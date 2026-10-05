/**
 * Locations module. Callers import this file, not the infrastructure files.
 * A Location is a place a Ride starts or ends. The record can be archived.
 * Transfers will point at a Location later; this module does not import them.
 */
export { archiveLocation, createLocation, listLocations, LocationArchivedError, LocationNotFoundError, updateLocation } from './infrastructure/location-access'
export { loadLocation, loadLocations } from './infrastructure/locations'
