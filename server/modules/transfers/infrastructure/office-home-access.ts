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
 * A driver is 403. No session is 401. Nothing is written: no audit entry
 * and no mail. The alarm is a mark on the unassigned list, not a message.
 */
export async function readOfficeHome(headers: Headers, now: Date = new Date()): Promise<OfficeHome> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    try {
      return await loadOfficeHome(transaction, now)
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
