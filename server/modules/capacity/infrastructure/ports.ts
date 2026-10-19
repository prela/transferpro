import type { TenantTransaction } from '../../../core/index'
import type { CapacityMinutesReader, CapacityPorts, OccupationPort } from '../application/ports'
import { loadTenantSettings } from '../../tenancy'

/**
 * The transfer duration and the relocation gap from the Tenant settings
 * row in tenancy, read on the caller's transaction, so the judge and the
 * save see one snapshot.
 */
export function tenantCapacityMinutes(transaction: TenantTransaction): CapacityMinutesReader {
  return async () => {
    const settings = await loadTenantSettings(transaction)
    return {
      transferDurationMinutes: settings.transferDurationMinutes,
      relocationGapMinutes: settings.relocationGapMinutes,
    }
  }
}

/**
 * The ports a capacity service reads through, on one tenant transaction.
 * `occupation` is the caller's adapter; transfers implements it.
 */
export function capacityPorts(transaction: TenantTransaction, occupation: OccupationPort): CapacityPorts {
  return { occupation, minutes: tenantCapacityMinutes(transaction) }
}
