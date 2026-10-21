import type { ActivePartnerReader, UnavailabilityReader } from './ports'
import { freePartnerIds } from '../domain/unavailability'

/**
 * Active Partners no unavailability window covers during `[from, to)`.
 * Capacity reads the ids through the partners module's public entry, which
 * the caller wires as `activePartners`. A handed-off Ride is not read: it
 * does not occupy the Partner (ADR-0034). The hard block uses this later.
 */
export async function freePartners(
  windows: UnavailabilityReader,
  activePartners: ActivePartnerReader,
  span: { readonly from: Date, readonly to: Date },
): Promise<string[]> {
  const active = await activePartners()
  if (active.length === 0 || span.to.getTime() <= span.from.getTime())
    return [...active]
  const covering = await windows({
    driverIds: [],
    vehicleIds: [],
    partnerIds: active,
    from: span.from,
    to: span.to,
  })
  return freePartnerIds(active, covering, span.from, span.to)
}
