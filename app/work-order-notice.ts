import type { WorkOrderNotice } from '../shared'

/**
 * One result on the action that saved the Ride. The sentence names the
 * Driver. The address is never part of this copy. ADR-0026.
 */
const NOTICE = {
  sent: { color: 'success', key: 'ride.workOrderSent' },
  no_email: { color: 'warning', key: 'ride.workOrderNoEmail' },
  failed: { color: 'error', key: 'ride.workOrderFailed' },
} as const

export function workOrderNotice(outcome: WorkOrderNotice['outcome']) {
  return NOTICE[outcome]
}
