/**
 * Clients module. Callers import this file, not the infrastructure files.
 * A Client is who booked a Transfer: an agency, a hotel, or an individual.
 */
export { ClientNotFoundError, createClient, listClients, updateClient } from './infrastructure/client-access'
/**
 * The list a Transfer offers, inside the caller's tenant transaction.
 * This module does not import transfers (ADR-0018).
 */
export { loadClient, loadClients } from './infrastructure/clients'
