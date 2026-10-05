/**
 * Expiring documents. Callers import this file, not the infrastructure file.
 * The list is computed when it is read. This module has no table.
 * Drivers and Vehicles are reached only through their public indexes.
 * This module does not import the transfers module.
 */
export { listExpiringDocuments } from './infrastructure/expiring-documents'
