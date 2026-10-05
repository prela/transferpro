/**
 * Clients module. Callers import this file, not the infrastructure files.
 * A Client is who booked a Transfer: an agency, a hotel, or an individual.
 */
export { ClientNotFoundError, createClient, listClients, updateClient } from './infrastructure/client-access'
