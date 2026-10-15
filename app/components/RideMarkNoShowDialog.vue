<script setup lang="ts">
import type { TransferDayRide } from '../../shared'
import { rideSchema } from '../../shared'
import { httpStatus } from '../transfer-day-http'
import { markNoShowButtonId } from '../transfer-ride-buttons'
import { canNoShow } from '../transfer-ride-guards'

const props = defineProps<{
  loadDay: () => Promise<void>
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

type MarkNoShowFailure
  = 'ride.markNoShowFailed'
    | 'ride.markNoShowConflict'
    | 'ride.signedOut'

const markingNoShow = ref<{ rideId: string, guestName: string } | null>(null)
const markNoShowPending = ref(false)
const markNoShowErrorKey = ref<MarkNoShowFailure | null>(null)

function open(ride: TransferDayRide) {
  if (!canNoShow(ride) || markNoShowPending.value)
    return
  markNoShowErrorKey.value = null
  markingNoShow.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeMarkNoShow() {
  if (markNoShowPending.value)
    return
  const rideId = markingNoShow.value?.rideId
  markNoShowErrorKey.value = null
  markingNoShow.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(markNoShowButtonId(rideId))?.focus()
  })
}

const markNoShowOpen = computed({
  get: () => markingNoShow.value !== null,
  set(open: boolean) {
    if (!open)
      closeMarkNoShow()
  },
})

function markNoShowFailureKey(error: unknown): MarkNoShowFailure {
  if (httpStatus(error) === 409)
    return 'ride.markNoShowConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.markNoShowFailed'
}

/**
 * POST /api/rides/:id/no-show with an empty body. Success reloads the day.
 * The Ride stays on the day list and shows No-show. The office may do this
 * before the wait. Cancel writes nothing. No fee is stored. No mail is sent.
 */
async function confirmMarkNoShow() {
  const target = markingNoShow.value
  if (!target || markNoShowPending.value)
    return
  markNoShowPending.value = true
  markNoShowErrorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${target.rideId}/no-show`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    markingNoShow.value = null
    await props.loadDay()
  }
  catch (error) {
    markNoShowErrorKey.value = markNoShowFailureKey(error)
    if (httpStatus(error) === 409)
      await props.loadDay()
  }
  finally {
    markNoShowPending.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <UModal
    v-model:open="markNoShowOpen"
    :title="t('ride.markNoShowTitle')"
    :description="t('ride.markNoShowBody')"
    :dismissible="!markNoShowPending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p v-if="markingNoShow">
        {{ markingNoShow.guestName }}
      </p>
      <UAlert
        v-if="markNoShowErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(markNoShowErrorKey)"
      />
    </template>
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="markNoShowPending"
        @click="closeMarkNoShow"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="markNoShowPending"
        :disabled="markNoShowPending"
        @click="confirmMarkNoShow"
      >
        {{ markNoShowPending ? t('ride.markNoShowConfirming') : t('ride.markNoShowConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
