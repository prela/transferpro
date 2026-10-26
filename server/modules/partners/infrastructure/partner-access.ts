import type { PartnerList } from '../../../../shared'
import { parseCreatePartner, parsePartnerPatch } from '../../../../shared'
import { TenantAccessError, withOfficeWrite, withTenantFromSession } from '../../tenancy'
import { addPartner, archiveStoredPartner, correctPartner, loadPartners, PartnerArchivedError, PartnerNotFoundError, restoreStoredPartner } from './partners'

export { PartnerArchivedError, PartnerNotFoundError }

function officeOnly(role: string): void {
  // A driver sees their own Rides. A Partner record is office work.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/** This Tenant's Partners. A driver is 403. Another Tenant sees none. */
export async function listPartners(headers: Headers, includeArchived: boolean): Promise<PartnerList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { partners: await loadPartners(transaction, includeArchived) }
  })
}

/**
 * Add a Partner. The body is parsed first, so an invalid name never opens
 * a session. A driver is 403. The insert and `partner.created` commit together.
 */
export async function createPartner(headers: Headers, raw: unknown) {
  return withOfficeWrite(headers, raw, parseCreatePartner, async ({ actor, transaction }, input) => {
    officeOnly(actor.role)
    return addPartner(transaction, actor.userId, input)
  })
}

/**
 * Correct a Partner. The body is parsed first. A missing Partner is 404.
 * An archived Partner is refused. A patch that matches the row writes nothing.
 */
export async function updatePartner(headers: Headers, partnerId: string, raw: unknown) {
  return withOfficeWrite(headers, raw, parsePartnerPatch, async ({ actor, transaction }, patch) => {
    officeOnly(actor.role)
    return correctPartner(transaction, actor.userId, partnerId, patch)
  })
}

/**
 * Archive a Partner. It leaves the default list. There is no delete.
 * A second archive writes nothing.
 */
export async function archivePartner(headers: Headers, partnerId: string, raw?: unknown) {
  return withOfficeWrite(headers, raw, () => undefined, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return archiveStoredPartner(transaction, actor.userId, partnerId)
  })
}

/**
 * Restore a Partner onto the default list.
 * A Partner who is already there writes nothing.
 */
export async function restorePartner(headers: Headers, partnerId: string, raw?: unknown) {
  return withOfficeWrite(headers, raw, () => undefined, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return restoreStoredPartner(transaction, actor.userId, partnerId)
  })
}
