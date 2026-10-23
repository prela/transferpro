<script setup lang="ts">
import type { Driver, TransferDayRide } from '../../shared'
import { cancelledRideResultSchema } from '../../shared'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'
import { httpStatus } from '../transfer-day-http'
import { driverDisplayName } from '../transfer-day-labels'
import { cancelRideButtonId } from '../transfer-ride-buttons'
import { canCallOff } from '../transfer-ride-guards'

const props = defineProps<{
  drivers: Driver[]
  loadDay: () => Promise<void>
}>()

const { t } = useI18n()
const toast = useToast()
const { present } = useWorkOrderPresenter()
const { notifyAuditChanged } = useAuditRefresh()

type CancelRideFailure
  = 'ride.cancelRideFailed'
    | 'ride.cancelRideConflict'
    | 'ride.signedOut'

const cancelling = ref<{
  rideId: string
  guestName: string
  unfinishedExtraVehicleCount: number
} | null>(null)
const cancelPending = ref(false)
const cancelErrorKey = ref<CancelRideFailure | null>(null)

/** A main Transfer with unfinished extra vehicles cancels the whole group. */
const groupCancel = computed(() => (cancelling.value?.unfinishedExtraVehicleCount ?? 0) > 0)

function groupQuestion(count: number): string {
  const vehicles = t(count === 1 ? 'ride.cancelGroupVehicle' : 'ride.cancelGroupVehicles')
  return t('ride.cancelGroupBody', { count, vehicles })
}

function driverLabel(id: string | null): string {
  return driverDisplayName(props.drivers, id, t('ride.unknownDriver'))
}

function open(ride: TransferDayRide) {
  if (!canCallOff(ride) || cancelPending.value)
    return
  cancelErrorKey.value = null
  // An extra vehicle is cancelled on its own. The count is only for a main Transfer.
  cancelling.value = {
    rideId: ride.rideId,
    guestName: ride.guestName,
    unfinishedExtraVehicleCount: ride.mainTransferId === null ? ride.unfinishedExtraVehicleCount : 0,
  }
}

function closeCancelRide() {
  if (cancelPending.value)
    return
  const rideId = cancelling.value?.rideId
  cancelErrorKey.value = null
  cancelling.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(cancelRideButtonId(rideId))?.focus()
  })
}

const cancelRideOpen = computed({
  get: () => cancelling.value !== null,
  set(open: boolean) {
    if (!open)
      closeCancelRide()
  },
})

function cancelRideFailureKey(error: unknown): CancelRideFailure {
  if (httpStatus(error) === 409)
    return 'ride.cancelRideConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.cancelRideFailed'
}

/**
 * POST /api/rides/:id/cancel with an empty body. Success reloads the day.
 * The Ride stays on the day list and shows Cancelled. Dismiss writes nothing.
 * A main Transfer with unfinished extra vehicles has already asked, and
 * this sends the whole group. Each Driver gets their own notice. A Ride
 * with no Driver shares one toast. The address is not on the response.
 */
async function confirmCancelRide() {
  const target = cancelling.value
  if (!target || cancelPending.value)
    return
  cancelPending.value = true
  cancelErrorKey.value = null
  try {
    const cancelled = cancelledRideResultSchema.parse(await $fetch(`/api/rides/${target.rideId}/cancel`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    // One Ride uses the named result. A group lists every cancelled Ride,
    // each with its own Driver. A Ride with no Driver shares one toast.
    const members = cancelled.cancelled ?? [{ ride: cancelled.ride, workOrders: cancelled.workOrders }]
    let quiet = false
    for (const member of members) {
      const notice = member.workOrders[0]
      if (notice === undefined) {
        quiet = true
        continue
      }
      present(member.ride.id, notice.outcome, driverLabel(notice.driverId), t('ride.cancelled'))
    }
    if (quiet) {
      // `role` is not on the toast prop type. A fresh literal would drop
      // the status announcement the board already relies on.
      const savedNotice = { title: t('ride.cancelled'), color: 'success' as const, role: 'status' as const }
      toast.add(savedNotice)
    }
    cancelling.value = null
    await props.loadDay()
  }
  catch (error) {
    cancelErrorKey.value = cancelRideFailureKey(error)
    if (httpStatus(error) === 409)
      await props.loadDay()
  }
  finally {
    cancelPending.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <UModal
    v-model:open="cancelRideOpen"
    :title="groupCancel ? t('ride.cancelGroupTitle') : t('ride.cancelRideTitle')"
    :description="groupCancel && cancelling ? groupQuestion(cancelling.unfinishedExtraVehicleCount) : t('ride.cancelRideBody')"
    :dismissible="!cancelPending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p v-if="cancelling">
        {{ cancelling.guestName }}
      </p>
      <UAlert
        v-if="cancelErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(cancelErrorKey)"
      />
    </template>
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="cancelPending"
        @click="closeCancelRide"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="cancelPending"
        :disabled="cancelPending"
        @click="confirmCancelRide"
      >
        {{ cancelPending
          ? t(groupCancel ? 'ride.cancelGroupConfirming' : 'ride.cancelRideConfirming')
          : t(groupCancel ? 'ride.cancelGroupConfirm' : 'ride.cancelRideConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
