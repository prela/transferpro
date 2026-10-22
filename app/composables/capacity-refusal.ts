import type { CapacityRefusalReason } from '../../shared'
import { ref } from 'vue'
import { capacityRefusalReason } from '../../shared'
import { errorCode } from '../transfer-day-http'

/**
 * One catch for the capacity refusals on a Ride command and on a Transfer
 * correction (ADR-0034). `fully_booked` opens Popunjeno and cannot be
 * confirmed. `ride_overlap` and `ride_unavailable` open the same dialog;
 * the caller sends `confirm: true` only when that dialog asks. A stale
 * save reloads when the caller gave a reload. Every other error stays
 * with the caller, and the dialog closes so a later failure is not still
 * the refusal.
 */
export function useCapacityRefusal(options: {
  /** 409 stale_save. Absent on a correction that has no reload. */
  onStale?: () => Promise<void>
  /**
   * The reason while the dialog is still closed. Hand-off starts on
   * unavailability, which is the refusal that screen usually meets.
   */
  initialReason?: CapacityRefusalReason
} = {}) {
  const refusalOpen = ref(false)
  const refusalReason = ref<CapacityRefusalReason>(options.initialReason ?? 'overlap')

  async function handleCapacityRefusal(error: unknown, onFailure: () => void): Promise<void> {
    const code = errorCode(error)
    const reason = capacityRefusalReason(code)
    if (reason) {
      refusalReason.value = reason
      refusalOpen.value = true
      return
    }
    refusalOpen.value = false
    if (code === 'stale_save' && options.onStale) {
      await options.onStale()
      return
    }
    onFailure()
  }

  return { refusalOpen, refusalReason, handleCapacityRefusal }
}
