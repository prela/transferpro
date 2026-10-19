import type { TenantTransaction } from '../../../core/index'
import type { OccupationPort } from '../../capacity'
import { readOccupationDuring, readOccupyingRides } from './ride-occupation'

/**
 * Transfers implements capacity's occupation port on one tenant
 * transaction (ADR-0034). The readers live in `ride-occupation.ts`, so a
 * test can spy on them as module exports.
 */
export function rideOccupation(transaction: TenantTransaction): OccupationPort {
  return {
    ridesOf: query => readOccupyingRides(transaction, query),
    ridesDuring: query => readOccupationDuring(transaction, query),
  }
}
