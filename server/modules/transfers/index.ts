/**
 * Transfers module. Callers import this file, not the infrastructure files.
 * A Transfer is the booking. Creating one creates exactly one unassigned Ride.
 * Clients and Locations are reached through their index files, by id.
 * Those modules do not import this one (ADR-0018).
 */
export { createTransfer, listTransferDay } from './infrastructure/transfer-access'
