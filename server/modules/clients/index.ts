/**
 * Clients module. Callers import this file, not the infrastructure files.
 * A Client is who booked a Transfer: an agency, a hotel, or an individual.
 * A daily job deletes contact persons removed more than 90 days ago.
 */
export { ClientNotFoundError, createClient, listClients, updateClient } from './infrastructure/client-access'
/**
 * Billing details for one Client, and whether they are complete (ADR-0051).
 * The helper refuses any role other than dispatcher or admin before it reads.
 * Invoicing calls it inside a tenant session. The office routes use the
 * session wrappers. `app.clients` is unchanged.
 */
export { loadClientBillingDetails } from './infrastructure/client-billing'
export { readClientBilling, writeClientBilling } from './infrastructure/client-billing-access'
/** The one standing note on the Client card (ADR-0049). */
export { readClientNote, writeClientNote } from './infrastructure/client-note-access'
/**
 * Live contact persons and the Client note, inside the caller's tenant
 * transaction. The helper refuses any role other than dispatcher or admin.
 * The Driver's read does not use this (ADR-0049).
 */
export { loadClientOfficeBriefs } from './infrastructure/client-office-briefs'
/**
 * The list a Transfer offers, inside the caller's tenant transaction.
 * This module does not import transfers (ADR-0018).
 */
export { loadClient, loadClients } from './infrastructure/clients'
export { ContactPersonNotFoundError, createContactPerson, listContactPersons, removeClientContactPerson, updateContactPerson } from './infrastructure/contact-person-access'
/** The daily delete of contact persons removed more than 90 days ago (ADR-0049). */
export { startContactPersonRetention } from './infrastructure/retention'
