import type { TenantTransaction } from '../../../core/index'
import type { ActivePartnerReader, CapacityMinutesReader, CapacityPorts, OccupationPort, UnavailabilityAuditFact, UnavailabilityPorts } from '../application/ports'
import { driverPresence } from '../../drivers'
import { loadActivePartnerIds, partnerPresence } from '../../partners'
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
/** Active Partner ids, through the partners module's public entry (ADR-0034). */
export function tenantActivePartnerIds(transaction: TenantTransaction): ActivePartnerReader {
  return () => loadActivePartnerIds(transaction)
}

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
    presence: (resource) => {
      if (resource.kind === 'driver')
        return driverPresence(transaction, resource.id)
      if (resource.kind === 'vehicle')
        return vehiclePresence(transaction, resource.id)
      return partnerPresence(transaction, resource.id)
    },
    lock: () => lockTenantCapacity(transaction),
    audit,
  }
}
