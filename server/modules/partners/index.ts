/**
 * Partners module. Callers import this file, not the infrastructure files.
 * A Partner is a subcontractor company the office can hand a Ride to.
 * It has no login and gets no mail. This module does not import transfers
 * (ADR-0036, ADR-0049).
 */
export { archivePartner, createPartner, listPartners, PartnerArchivedError, PartnerNotFoundError, restorePartner, updatePartner } from './infrastructure/partner-access'
export { loadActivePartnerIds, loadPartner, loadPartnerOfficeContacts, loadPartners, partnerIsActive, partnerPresence, partnerPresenceForHandoff } from './infrastructure/partners'
