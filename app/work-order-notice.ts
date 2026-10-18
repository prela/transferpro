import type { WorkOrderNotice } from '../shared'

/**
 * One result on the action that saved the Ride. The sentence names the
 * Driver. The address is never part of this copy. ADR-0026.
 */
const NOTICE = {
  sent: { color: 'success', key: 'ride.workOrderSent' },
  no_email: { color: 'warning', key: 'ride.workOrderNoEmail' },
  failed: { color: 'error', key: 'ride.workOrderFailed' },
  stale: { color: 'warning', key: 'ride.workOrderStale' },
} as const satisfies Record<WorkOrderNotice['outcome'], { color: 'success' | 'warning' | 'error', key: string }>

export function workOrderNotice(outcome: WorkOrderNotice['outcome']) {
  return NOTICE[outcome]
}

/**
 * "Sent" is a toast. "No email", a failed first attempt, and a stale one
 * stay in the Ride detail until the user closes them (ADR-0038). The failed
 * sentence says the send will be tried again. The stale sentence says it
 * was not sent because it no longer matters. Each still names the Driver,
 * not the address.
 */
export function workOrderStaysInDetail(outcome: WorkOrderNotice['outcome']): outcome is 'no_email' | 'failed' | 'stale' {
  return outcome !== 'sent'
}
