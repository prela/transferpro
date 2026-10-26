import type { ContactPersonList } from '../../../../shared'
import { parseContactPersonPatch, parseCreateContactPerson, parseRemoveContactPerson } from '../../../../shared'
import { TenantAccessError, withOfficeWrite, withTenantFromSession } from '../../tenancy'
import { ClientNotFoundError } from './clients'
import { addContactPerson, ContactPersonNotFoundError, correctContactPerson, loadContactPersons, removeContactPerson } from './contact-persons'

export { ClientNotFoundError, ContactPersonNotFoundError }

function officeOnly(role: string): void {
  // A driver does not keep the Client card. Listing contacts is office work.
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
}

/**
 * This Client's contact persons. The role is checked here, not by the route's
 * caller. A driver is 403. Another Tenant's Client is 404.
 */
export async function listContactPersons(headers: Headers, clientId: string): Promise<ContactPersonList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { contactPersons: await loadContactPersons(transaction, clientId) }
  })
}

/**
 * Add a contact person. The body is parsed first, so a bad name or a missing
 * phone and email never opens a session. Adding sends no version.
 */
export async function createContactPerson(headers: Headers, clientId: string, raw: unknown) {
  return withOfficeWrite(headers, raw, parseCreateContactPerson, async ({ actor, transaction }, input) => {
    officeOnly(actor.role)
    return addContactPerson(transaction, actor.userId, clientId, input)
  })
}

/**
 * Correct a contact person. A missing version is 400 before a session opens.
 * A stale version is 409 `stale_save`. A patch that matches the row writes nothing.
 */
export async function updateContactPerson(headers: Headers, clientId: string, contactPersonId: string, raw: unknown) {
  return withOfficeWrite(headers, raw, parseContactPersonPatch, async ({ actor, transaction }, patch) => {
    officeOnly(actor.role)
    return correctContactPerson(transaction, actor.userId, clientId, contactPersonId, patch)
  })
}

/**
 * Remove a contact person from the card. The version is parsed first.
 * A mismatch is 409 `stale_save` and writes nothing.
 */
export async function removeClientContactPerson(headers: Headers, clientId: string, contactPersonId: string, raw: unknown) {
  return withOfficeWrite(headers, raw, parseRemoveContactPerson, async ({ actor, transaction }, body) => {
    officeOnly(actor.role)
    return removeContactPerson(transaction, actor.userId, clientId, contactPersonId, body.version)
  })
}
