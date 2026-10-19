import type { TenantTransaction } from '../../../core/index'
import type { CapacityMinutesReader, CapacityPorts, OccupationPort, UnavailabilityAuditFact, UnavailabilityPorts } from '../application/ports'
import { driverPresence } from '../../drivers'
import { loadTenantSettings } from '../../tenancy'
import { vehiclePresence } from '../../vehicles'
import { lockTenantCapacity } from './lock'
import { unavailabilityReader, unavailabilityStore } from './unavailability-store'

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
 * `occupation` is the caller's adapter; transfers implements it. The
 * windows are capacity's own table.
 */
export function capacityPorts(transaction: TenantTransaction, occupation: OccupationPort): CapacityPorts {
  return { occupation, minutes: tenantCapacityMinutes(transaction), windows: unavailabilityReader(transaction) }
}

/**
 * The ports of the window commands, on one tenant transaction. Capacity
 * imports neither transfers nor audit, so the caller passes the occupation
 * adapter and the audit append in.
 */
export function unavailabilityPorts(
  transaction: TenantTransaction,
  occupation: OccupationPort,
  audit: (fact: UnavailabilityAuditFact) => Promise<void>,
): UnavailabilityPorts {
  return {
    ...capacityPorts(transaction, occupation),
    store: unavailabilityStore(transaction),
    presence: resource => resource.kind === 'driver'
      ? driverPresence(transaction, resource.id)
      : vehiclePresence(transaction, resource.id),
    lock: () => lockTenantCapacity(transaction),
    audit,
  }
}
