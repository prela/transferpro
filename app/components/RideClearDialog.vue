<script setup lang="ts">
import type { Driver, TransferDayRide } from '../../shared'
import { assignedRideSchema } from '../../shared'
import { errorCode, httpStatus } from '../transfer-day-http'
import { clearRideButtonId } from '../transfer-ride-buttons'
import { canChangeAssignment } from '../transfer-ride-guards'
import { workOrderNotice } from '../work-order-notice'

const props = defineProps<{
  drivers: Driver[]
  loadDay: () => Promise<void>
}>()

const { t } = useI18n()
const toast = useToast()
const { notifyAuditChanged } = useAuditRefresh()

const clearing = ref<{ rideId: string, guestName: string } | null>(null)
const clearPending = ref(false)
const clearErrorKey = ref<'ride.notOpen' | 'ride.notFound' | 'ride.signedOut' | 'ride.changeFailed' | null>(null)

/** The day list stores ids. The screen shows the name, never the id. */
function driverLabel(id: string | null): string {
  if (id === null)
    return ''
  return props.drivers.find(driver => driver.id === id)?.name ?? t('ride.unknownDriver')
}

function open(ride: TransferDayRide) {
  if (!canChangeAssignment(ride) || clearPending.value)
    return
  clearErrorKey.value = null
  clearing.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeClear() {
  if (clearPending.value)
    return
  const rideId = clearing.value?.rideId
  clearErrorKey.value = null
  clearing.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(clearRideButtonId(rideId))?.focus()
  })
}

const clearOpen = computed({
  get: () => clearing.value !== null,
  set(open: boolean) {
    if (!open)
      closeClear()
  },
})

async function confirmClear() {
  const target = clearing.value
  if (!target || clearPending.value)
    return
  clearPending.value = true
  clearErrorKey.value = null
  try {
    const cleared = assignedRideSchema.parse(await $fetch(`/api/rides/${target.rideId}/clear`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    // The notice names the Driver who lost the Ride. The address is not on the response.
    const notice = cleared.workOrders[0]
    const shown = notice === undefined ? undefined : workOrderNotice(notice.outcome)
    toast.add({
      title: t('ride.cleared'),
      description: shown === undefined || notice === undefined ? undefined : t(shown.key, { name: driverLabel(notice.driverId) }),
      color: shown?.color ?? 'success',
    })
    clearing.value = null
    await props.loadDay()
  }
  catch (error) {
    if (errorCode(error) === 'ride_not_open')
      clearErrorKey.value = 'ride.notOpen'
    else if (httpStatus(error) === 401)
      clearErrorKey.value = 'ride.signedOut'
    else if (httpStatus(error) === 404)
      clearErrorKey.value = 'ride.notFound'
    else
      clearErrorKey.value = 'ride.changeFailed'
    if (httpStatus(error) === 409)
      await props.loadDay()
  }
  finally {
    clearPending.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <UModal
    v-model:open="clearOpen"
    :title="t('ride.clearTitle')"
    :description="t('ride.clearBody')"
    :dismissible="!clearPending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p v-if="clearing">
        {{ clearing.guestName }}
      </p>
      <UAlert
        v-if="clearErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(clearErrorKey)"
      />
    </template>
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="clearPending"
        @click="closeClear"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="clearPending"
        :disabled="clearPending"
        @click="confirmClear"
      >
        {{ clearPending ? t('ride.clearing') : t('ride.clearConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
