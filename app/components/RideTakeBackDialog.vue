<script setup lang="ts">
import type { DisplayLocale, LiveRefreshOutcome, TransferDayRide } from '../../shared'
import { handedOffRideResultSchema } from '../../shared'
import { errorCode, httpStatus } from '../transfer-day-http'
import { canTakeBack } from '../transfer-ride-guards'

const props = defineProps<{
  rides: TransferDayRide[]
  timeZone: string
  locale: DisplayLocale
  /** Closes the detail after a take-back that saved. */
  loadDay: () => Promise<void>
  /** Reloads the day and leaves the dialog open. */
  reloadDay: () => Promise<LiveRefreshOutcome | void>
}>()

const { t } = useI18n()
const toast = useToast()
const { notifyAuditChanged } = useAuditRefresh()

type TakeBackFailure
  = 'ride.takeBackFailed'
    | 'ride.takeBackConflict'
    | 'ride.notFound'
    | 'ride.signedOut'

const taking = ref<{ rideId: string, guestName: string, version: number } | null>(null)
const pending = ref(false)
const errorKey = ref<TakeBackFailure | null>(null)
const stale = ref(false)
/** A failed day read has no new author. The notice then says someone, not the opened row. */
const staleReadFailed = ref(false)
const refreshing = ref(false)

const staleRide = computed(() => {
  const id = taking.value?.rideId
  if (!id)
    return null
  return props.rides.find(ride => ride.rideId === id) ?? null
})

function open(ride: TransferDayRide) {
  if (!canTakeBack(ride) || pending.value)
    return
  errorKey.value = null
  stale.value = false
  staleReadFailed.value = false
  taking.value = { rideId: ride.rideId, guestName: ride.guestName, version: ride.version }
}

function close() {
  if (pending.value)
    return
  errorKey.value = null
  stale.value = false
  staleReadFailed.value = false
  taking.value = null
}

const openModel = computed({
  get: () => taking.value !== null,
  set(next: boolean) {
    if (!next)
      close()
  },
})

function failureKey(error: unknown): TakeBackFailure {
  if (errorCode(error) === 'ride_not_handed_off' || httpStatus(error) === 409)
    return 'ride.takeBackConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  if (httpStatus(error) === 404)
    return 'ride.notFound'
  return 'ride.takeBackFailed'
}

/**
 * POST /api/rides/:id/take-back with the opened version. Success reloads
 * the day. The Ride stays on the list as unassigned. No mail is sent.
 */
async function confirm() {
  const target = taking.value
  if (!target || pending.value)
    return
  pending.value = true
  errorKey.value = null
  stale.value = false
  staleReadFailed.value = false
  try {
    handedOffRideResultSchema.parse(await $fetch(`/api/rides/${target.rideId}/take-back`, {
      method: 'POST',
      body: { version: target.version },
    }))
    notifyAuditChanged()
    const savedNotice = { title: t('ride.takenBack'), color: 'success' as const, role: 'status' }
    toast.add(savedNotice)
    taking.value = null
    await props.loadDay()
  }
  catch (error) {
    if (errorCode(error) === 'stale_save') {
      const outcome = await props.reloadDay()
      staleReadFailed.value = outcome === 'fail'
      stale.value = true
      return
    }
    errorKey.value = failureKey(error)
    if (httpStatus(error) === 409)
      await props.loadDay()
  }
  finally {
    pending.value = false
  }
}

async function refreshStale() {
  if (refreshing.value)
    return
  refreshing.value = true
  try {
    const outcome = await props.reloadDay()
    if (outcome === 'fail')
      return
    await nextTick()
    const ride = staleRide.value
    if (!taking.value)
      return
    if (ride && outcome === 'stale' && ride.version === taking.value.version)
      return
    if (!ride || !canTakeBack(ride)) {
      close()
      return
    }
    taking.value = { rideId: ride.rideId, guestName: ride.guestName, version: ride.version }
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
    v-model:open="openModel"
    :title="t('ride.takeBackTitle')"
    :description="t('ride.takeBackBody')"
    :dismissible="!pending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p v-if="taking">
        {{ taking.guestName }}
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
        v-else-if="errorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(errorKey)"
      />
    </template>
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="pending"
        @click="close"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="pending"
        :disabled="pending"
        @click="confirm"
      >
        {{ pending ? t('ride.takingBack') : t('ride.takeBackConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
