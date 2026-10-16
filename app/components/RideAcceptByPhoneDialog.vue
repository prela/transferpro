<script setup lang="ts">
import type { TransferDayRide } from '../../shared'
import { rideSchema } from '../../shared'
import { httpStatus } from '../transfer-day-http'
import { canRecordAcceptanceByPhone } from '../transfer-ride-guards'

const props = defineProps<{
  ride: TransferDayRide
  loadDay: () => Promise<void>
}>()

const emit = defineEmits<{
  done: []
  cancel: []
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()

type AcceptByPhoneFailure
  = 'ride.acceptByPhoneFailed'
    | 'ride.acceptByPhoneConflict'
    | 'ride.signedOut'

const pending = ref(false)
const errorKey = ref<AcceptByPhoneFailure | null>(null)

function failureKey(error: unknown): AcceptByPhoneFailure {
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
 * This action does not send mail. The confirmation lives in the Ride detail.
 */
async function confirm() {
  if (!canRecordAcceptanceByPhone(props.ride) || pending.value)
    return
  pending.value = true
  errorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${props.ride.rideId}/accept-by-phone`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    await props.loadDay()
    emit('done')
  }
  catch (error) {
    errorKey.value = failureKey(error)
    if (httpStatus(error) === 409)
      await props.loadDay()
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <section :aria-labelledby="titleId">
    <h2
      :id="titleId"
      class="mb-2 text-lg font-semibold"
    >
      {{ t('ride.acceptByPhoneTitle') }}
    </h2>
    <p class="mb-4">
      {{ t('ride.acceptByPhoneBody') }}
    </p>
    <p class="mb-4">
      {{ ride.guestName }}
    </p>
    <UAlert
      v-if="errorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(errorKey)"
    />
    <div class="flex flex-wrap gap-2">
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="min-h-12"
        :disabled="pending"
        @click="emit('cancel')"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="min-h-12"
        :loading="pending"
        :disabled="pending"
        @click="confirm"
      >
        {{ pending ? t('ride.acceptByPhoneConfirming') : t('ride.acceptByPhoneConfirm') }}
      </UButton>
    </div>
  </section>
</template>
