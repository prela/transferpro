<script setup lang="ts">
import type { DisplayLocale, LiveRefreshOutcome, TransferDayRide } from '../../shared'
import { z } from 'zod'
import { handedOffDetailPrimary } from '../../shared'
import { errorCode, httpStatus } from '../transfer-day-http'

const props = defineProps<{
  rides: TransferDayRide[]
  timeZone: string
  locale: DisplayLocale
  /** Closes the detail after a confirmation that saved. */
  loadDay: () => Promise<void>
  /** Reloads the day and leaves the dialog open. */
  reloadDay: () => Promise<LiveRefreshOutcome | void>
}>()

const { t } = useI18n()
const toast = useToast()
const { notifyAuditChanged } = useAuditRefresh()

type ConfirmationFailure
  = 'ride.partnerConfirmationFailed'
    | 'ride.notAwaitingPartnerConfirmation'
    | 'ride.signedOut'

const recording = ref<{ rideId: string, guestName: string, version: number } | null>(null)
const pending = ref(false)
const errorKey = ref<ConfirmationFailure | null>(null)
const stale = ref(false)
/** A failed day read has no new author. The notice then says someone, not the opened row. */
const staleReadFailed = ref(false)
const refreshing = ref(false)

const staleRide = computed(() => {
  const id = recording.value?.rideId
  if (!id)
    return null
  return props.rides.find(ride => ride.rideId === id) ?? null
})

function canRecord(ride: TransferDayRide): boolean {
  return ride.state === 'handed_off' && ride.partnerConfirmed === false
}

function open(ride: TransferDayRide) {
  if (!canRecord(ride) || pending.value)
    return
  errorKey.value = null
  stale.value = false
  staleReadFailed.value = false
  recording.value = { rideId: ride.rideId, guestName: ride.guestName, version: ride.version }
}

function close() {
  if (pending.value)
    return
  errorKey.value = null
  stale.value = false
  staleReadFailed.value = false
  recording.value = null
}

const openModel = computed({
  get: () => recording.value !== null,
  set(next: boolean) {
    if (!next)
      close()
  },
})

function failureKey(error: unknown): ConfirmationFailure {
  if (errorCode(error) === 'ride_not_awaiting_partner_confirmation')
    return 'ride.notAwaitingPartnerConfirmation'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.partnerConfirmationFailed'
}

const savedSchema = z.object({
  rideId: z.uuid(),
  partnerConfirmed: z.literal(true),
  version: z.number().int().nonnegative(),
})

/**
 * POST /api/rides/:id/partner-confirmation with the opened version.
 * Success reloads the day. A stale form offers the existing refresh.
 * A Ride that no longer waits shows the fixed sentence (ADR-0062).
 */
async function confirm() {
  const target = recording.value
  if (!target || pending.value)
    return
  pending.value = true
  errorKey.value = null
  stale.value = false
  staleReadFailed.value = false
  try {
    savedSchema.parse(await $fetch(`/api/rides/${target.rideId}/partner-confirmation`, {
      method: 'POST',
      body: { version: target.version },
    }))
    notifyAuditChanged()
    const savedNotice = { title: t('ride.partnerConfirmationRecorded'), color: 'success' as const, role: 'status' as const }
    toast.add(savedNotice)
    recording.value = null
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
    if (!recording.value)
      return
    if (ride && outcome === 'stale' && ride.version === recording.value.version)
      return
    // The pickup may have passed while the dialog was open. The record
    // itself is still allowed; only a Ride that no longer waits closes.
    if (!ride || !canRecord(ride) || handedOffDetailPrimary(ride, Date.now()) === null) {
      close()
      return
    }
    recording.value = { rideId: ride.rideId, guestName: ride.guestName, version: ride.version }
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
    :title="t('ride.recordPartnerConfirmationTitle')"
    :description="t('ride.recordPartnerConfirmationBody')"
    :dismissible="!pending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p v-if="recording">
        {{ recording.guestName }}
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
        {{ pending ? t('ride.recordingPartnerConfirmation') : t('ride.recordPartnerConfirmationSubmit') }}
      </UButton>
    </template>
  </UModal>
</template>
