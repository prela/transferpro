import type { OfficeHome } from '../../../../shared'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { loadOfficeHome } from './office-home'

function officeOnly(role: string): void {
  // The office snapshot is the same allow-list as the board.
  // A driver is refused before a Ride is read.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * The three lists and the seven operational-day counts, taken at `now`.
 * An unassigned row carries a decline alert and the declining Driver's
 * name, for any pickup day. Failed invitations, with the invitee's email,
 * are on an Admin read only. A driver is 403. No session is 401. Nothing
 * is written: no audit entry and no mail. The alarm is a mark on the
 * unassigned list, not a message. The name is on the response only.
 */
export async function readOfficeHome(headers: Headers, now: Date = new Date()): Promise<OfficeHome> {
  return withTenantFromSession(headers, async ({ actor, context, transaction }) => {
    officeOnly(actor.role)
    try {
      return await loadOfficeHome(transaction, now, { context, role: actor.role })
    }
    catch (error) {
      if (error instanceof TenantAccessError)
        throw error
      if (error instanceof Error && error.message === 'Office home read failed')
        throw error
      throw new Error('Office home read failed')
    }
  })
}
