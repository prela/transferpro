import type { WorkOrderNotice } from '../../shared'
import { workOrderNotice, workOrderStaysInDetail } from '../work-order-notice'

/**
 * Work-order results that must stay on screen. A toast would disappear.
 * The Ride detail lists these until the user closes each one. ADR-0038.
 */
export interface KeptWorkOrder {
  id: string
  rideId: string
  outcome: 'no_email' | 'failed' | 'stale'
  driverName: string
  /** The command that produced the notice, so two results stay distinct. */
  actionTitle: string
}

export function useKeptWorkOrders() {
  const kept = useState<KeptWorkOrder[]>('kept-work-orders', () => [])

  function push(item: Omit<KeptWorkOrder, 'id'>) {
    kept.value = [...kept.value, { ...item, id: `${Date.now()}-${kept.value.length}` }]
  }

  function dismiss(id: string) {
    kept.value = kept.value.filter(entry => entry.id !== id)
  }

  return { kept, push, dismiss }
}

/**
 * "Sent" is a toast. The visible root is `role="status"` and Reka announces
 * it politely (`type: 'background'`). Every other outcome stays in the
 * detail, with the same action title, until the user closes them.
 */
export function useWorkOrderPresenter() {
  const toast = useToast()
  const { t } = useI18n()
  const { push } = useKeptWorkOrders()
  // A no-email or failed result of the command that just saved. Cleared when
  // the day decides whether the detail stays open.
  const holdDetail = useState('work-order-hold-detail', () => false)

  function present(
    rideId: string,
    outcome: WorkOrderNotice['outcome'],
    driverName: string,
    actionTitle: string,
  ) {
    if (workOrderStaysInDetail(outcome)) {
      push({ rideId, outcome, driverName, actionTitle })
      holdDetail.value = true
      return
    }
    const shown = workOrderNotice(outcome)
    // A held object, so the status role is an attribute on the toast root.
    // A fresh literal would be rejected: Toast's props do not list `role`.
    const sent = {
      title: actionTitle,
      description: t(shown.key, { name: driverName }),
      color: 'success' as const,
      type: 'background' as const,
      role: 'status',
    }
    toast.add(sent)
  }

  function takeHold(): boolean {
    const held = holdDetail.value
    holdDetail.value = false
    return held
  }

  return { present, takeHold }
}
