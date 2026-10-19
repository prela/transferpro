<script setup lang="ts">
import type { DisplayLocale, Driver, LiveRefreshOutcome, TransferDayRide } from '../../shared'
import { assignedRideSchema } from '../../shared'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'
import { errorCode, httpStatus } from '../transfer-day-http'
import { driverDisplayName } from '../transfer-day-labels'
import { clearRideButtonId } from '../transfer-ride-buttons'
import { canChangeAssignment } from '../transfer-ride-guards'

const props = defineProps<{
  drivers: Driver[]
  rides: TransferDayRide[]
  timeZone: string
  locale: DisplayLocale
  /** Closes the detail after a clear that saved. */
  loadDay: () => Promise<void>
  /** Reloads the day and leaves the dialog open. */
  reloadDay: () => Promise<LiveRefreshOutcome | void>
}>()

const { t } = useI18n()
const toast = useToast()
const { present } = useWorkOrderPresenter()
const { notifyAuditChanged } = useAuditRefresh()

const clearing = ref<{ rideId: string, guestName: string, version: number } | null>(null)
const clearPending = ref(false)
const clearErrorKey = ref<'ride.notOpen' | 'ride.notFound' | 'ride.signedOut' | 'ride.changeFailed' | null>(null)
const stale = ref(false)
/** A failed day read has no new author. The notice then says someone, not the opened row. */
const staleReadFailed = ref(false)
const refreshing = ref(false)

const staleRide = computed(() => {
  const id = clearing.value?.rideId
  if (!id)
    return null
  return props.rides.find(ride => ride.rideId === id) ?? null
})

function driverLabel(id: string | null): string {
  return driverDisplayName(props.drivers, id, t('ride.unknownDriver'))
}

function open(ride: TransferDayRide) {
  if (!canChangeAssignment(ride) || clearPending.value)
    return
  clearErrorKey.value = null
  stale.value = false
  staleReadFailed.value = false
  clearing.value = { rideId: ride.rideId, guestName: ride.guestName, version: ride.version }
}

function closeClear() {
  if (clearPending.value)
    return
  const rideId = clearing.value?.rideId
  clearErrorKey.value = null
  stale.value = false
  staleReadFailed.value = false
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
  stale.value = false
  staleReadFailed.value = false
  try {
    const cleared = assignedRideSchema.parse(await $fetch(`/api/rides/${target.rideId}/clear`, {
      method: 'POST',
      body: { version: target.version },
    }))
    notifyAuditChanged()
    // The notice names the Driver who lost the Ride. The address is not on the response.
    const notice = cleared.workOrders[0]
    if (notice === undefined) {
      const savedNotice = { title: t('ride.cleared'), color: 'success' as const, role: 'status' }
      toast.add(savedNotice)
    }
    else {
      present(target.rideId, notice.outcome, driverLabel(notice.driverId), t('ride.cleared'))
    }
    clearing.value = null
    await props.loadDay()
  }
  catch (error) {
    if (errorCode(error) === 'stale_save') {
      const outcome = await props.reloadDay()
      staleReadFailed.value = outcome === 'fail'
      stale.value = true
      return
    }
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

async function refreshStale() {
  if (refreshing.value)
    return
  refreshing.value = true
  try {
    const outcome = await props.reloadDay()
    // A failed read keeps the last rows. A superseded one may not have
    // applied its body yet. Either way the dialog stays on the opened version.
    if (outcome === 'fail')
      return
    await nextTick()
    const ride = staleRide.value
    if (!clearing.value)
      return
    if (ride && outcome === 'stale' && ride.version === clearing.value.version)
      return
    // A missing, finished, or unassigned Ride can no longer be cleared.
    if (!ride || !canChangeAssignment(ride)) {
      closeClear()
      return
    }
    clearing.value = { rideId: ride.rideId, guestName: ride.guestName, version: ride.version }
    stale.value = false
    staleReadFailed.value = false
  }
  finally {
    refreshing.value = false
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
      <StaleSaveAlert
        v-if="stale"
        class="mt-4"
        :changed-by-name="staleReadFailed ? null : (staleRide?.changedByName ?? null)"
        :changed-at="staleReadFailed ? null : (staleRide?.changedAt ?? null)"
        :time-zone="timeZone"
        :locale="locale"
        phone
        :pending="refreshing"
        @refresh="refreshStale"
      />
      <UAlert
        v-else-if="clearErrorKey"
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
