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

const cancelling = ref<{ rideId: string, guestName: string } | null>(null)
const cancelPending = ref(false)
const cancelErrorKey = ref<CancelRideFailure | null>(null)

function driverLabel(id: string | null): string {
  return driverDisplayName(props.drivers, id, t('ride.unknownDriver'))
}

function open(ride: TransferDayRide) {
  if (!canCallOff(ride) || cancelPending.value)
    return
  cancelErrorKey.value = null
  cancelling.value = { rideId: ride.rideId, guestName: ride.guestName }
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
 * The notice names the current Driver. A Ride with no Driver has no notice.
 * The address is not on the response.
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
    const notice = cancelled.workOrders[0]
    if (notice === undefined) {
      const savedNotice = { title: t('ride.cancelled'), color: 'success' as const, role: 'status' }
      toast.add(savedNotice)
    }
    else {
      present(target.rideId, notice.outcome, driverLabel(notice.driverId), t('ride.cancelled'))
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
    :title="t('ride.cancelRideTitle')"
    :description="t('ride.cancelRideBody')"
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
        {{ cancelPending ? t('ride.cancelRideConfirming') : t('ride.cancelRideConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
