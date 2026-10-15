<script setup lang="ts">
import type { TransferDayRide } from '../../shared'
import { rideSchema } from '../../shared'
import { httpStatus } from '../transfer-day-http'
import { markDoneButtonId } from '../transfer-ride-buttons'
import { canFinish } from '../transfer-ride-guards'

const props = defineProps<{
  loadDay: () => Promise<void>
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

type MarkDoneFailure
  = 'ride.markDoneFailed'
    | 'ride.markDoneConflict'
    | 'ride.signedOut'

const markingDone = ref<{ rideId: string, guestName: string } | null>(null)
const markDonePending = ref(false)
const markDoneErrorKey = ref<MarkDoneFailure | null>(null)

function open(ride: TransferDayRide) {
  if (!canFinish(ride) || markDonePending.value)
    return
  markDoneErrorKey.value = null
  markingDone.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeMarkDone() {
  if (markDonePending.value)
    return
  const rideId = markingDone.value?.rideId
  markDoneErrorKey.value = null
  markingDone.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(markDoneButtonId(rideId))?.focus()
  })
}

const markDoneOpen = computed({
  get: () => markingDone.value !== null,
  set(open: boolean) {
    if (!open)
      closeMarkDone()
  },
})

function markDoneFailureKey(error: unknown): MarkDoneFailure {
  if (httpStatus(error) === 409)
    return 'ride.markDoneConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.markDoneFailed'
}

/**
 * POST /api/rides/:id/done with an empty body. Success reloads the day.
 * The Ride stays on the day list and shows Done. Cancel writes nothing.
 * This action does not send mail.
 */
async function confirmMarkDone() {
  const target = markingDone.value
  if (!target || markDonePending.value)
    return
  markDonePending.value = true
  markDoneErrorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${target.rideId}/done`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    markingDone.value = null
    await props.loadDay()
  }
  catch (error) {
    markDoneErrorKey.value = markDoneFailureKey(error)
    if (httpStatus(error) === 409)
      await props.loadDay()
  }
  finally {
    markDonePending.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <UModal
    v-model:open="markDoneOpen"
    :title="t('ride.markDoneTitle')"
    :description="t('ride.markDoneBody')"
    :dismissible="!markDonePending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p v-if="markingDone">
        {{ markingDone.guestName }}
      </p>
      <UAlert
        v-if="markDoneErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(markDoneErrorKey)"
      />
    </template>
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="markDonePending"
        @click="closeMarkDone"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="markDonePending"
        :disabled="markDonePending"
        @click="confirmMarkDone"
      >
        {{ markDonePending ? t('ride.markDoneConfirming') : t('ride.markDoneConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
