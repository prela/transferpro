<script setup lang="ts">
import type { TransferDayRide } from '../../shared'
import { rideSchema } from '../../shared'
import { httpStatus } from '../transfer-day-http'
import { acceptByPhoneButtonId } from '../transfer-ride-buttons'
import { canRecordAcceptanceByPhone } from '../transfer-ride-guards'

const props = defineProps<{
  loadDay: () => Promise<void>
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

type AcceptByPhoneFailure
  = 'ride.acceptByPhoneFailed'
    | 'ride.acceptByPhoneConflict'
    | 'ride.signedOut'

// The Ride whose phone confirmation the office is about to record. Null closes the dialog.
const acceptingByPhone = ref<{ rideId: string, guestName: string } | null>(null)
const acceptByPhonePending = ref(false)
const acceptByPhoneErrorKey = ref<AcceptByPhoneFailure | null>(null)

function open(ride: TransferDayRide) {
  if (!canRecordAcceptanceByPhone(ride) || acceptByPhonePending.value)
    return
  acceptByPhoneErrorKey.value = null
  acceptingByPhone.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeAcceptByPhone() {
  // Leave the dialog up while the post is in flight. Closing would not undo it.
  if (acceptByPhonePending.value)
    return
  const rideId = acceptingByPhone.value?.rideId
  acceptByPhoneErrorKey.value = null
  acceptingByPhone.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(acceptByPhoneButtonId(rideId))?.focus()
  })
}

// A different day is a different list. Close the phone dialog. That does not post.
function onDayChanged() {
  acceptingByPhone.value = null
  acceptByPhoneErrorKey.value = null
}

// Esc, the overlay, and the close control write nothing. Cancel uses the same path.
const acceptByPhoneOpen = computed({
  get: () => acceptingByPhone.value !== null,
  set(open: boolean) {
    if (!open)
      closeAcceptByPhone()
  },
})

function acceptByPhoneFailureKey(error: unknown): AcceptByPhoneFailure {
  // 409 is ride_not_acceptable: the flag is off, or the Ride is no longer assigned.
  if (httpStatus(error) === 409)
    return 'ride.acceptByPhoneConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.acceptByPhoneFailed'
}

/**
 * POST /api/rides/:id/accept-by-phone with an empty body. There is no note.
 * Success reloads the day so the row shows Accepted. Cancel never calls this.
 * This action does not send mail.
 */
async function confirmAcceptByPhone() {
  const target = acceptingByPhone.value
  if (!target || acceptByPhonePending.value)
    return
  acceptByPhonePending.value = true
  acceptByPhoneErrorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${target.rideId}/accept-by-phone`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    acceptingByPhone.value = null
    await props.loadDay()
  }
  catch (error) {
    acceptByPhoneErrorKey.value = acceptByPhoneFailureKey(error)
    // The list the office confirmed was already stale. Reload so the control follows the row.
    if (httpStatus(error) === 409)
      await props.loadDay()
  }
  finally {
    acceptByPhonePending.value = false
  }
}

defineExpose({ open, onDayChanged })
</script>

<template>
  <UModal
    v-model:open="acceptByPhoneOpen"
    :title="t('ride.acceptByPhoneTitle')"
    :description="t('ride.acceptByPhoneBody')"
    :dismissible="!acceptByPhonePending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p v-if="acceptingByPhone">
        {{ acceptingByPhone.guestName }}
      </p>
      <UAlert
        v-if="acceptByPhoneErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(acceptByPhoneErrorKey)"
      />
    </template>
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="acceptByPhonePending"
        @click="closeAcceptByPhone"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="acceptByPhonePending"
        :disabled="acceptByPhonePending"
        @click="confirmAcceptByPhone"
      >
        {{ acceptByPhonePending ? t('ride.acceptByPhoneConfirming') : t('ride.acceptByPhoneConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
