<script setup lang="ts">
import { instantFromWallClock, recordedLandingSchema, wallClockInTimeZone } from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'

const props = defineProps<{
  rideId: string
  guestName: string
  /** The stored instant, or null when the Transfer has no landing time yet. */
  landingAt: string | null
  timeZone: string
  /** Phone uses the large targets. Desktop uses the office size. */
  phone?: boolean
}>()

const emit = defineEmits<{
  saved: []
  cancel: []
}>()
const controlSize = computed(() => commandControlSize(props.phone === true))
const controlClass = computed(() => commandControlClass(props.phone === true))

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()

const wall = ref(props.landingAt === null ? '' : wallClockInTimeZone(props.timeZone, new Date(props.landingAt)))
const pending = ref<'save' | 'clear' | null>(null)
const errorKey = ref<LandingFailure | null>(null)

type LandingFailure
  = 'ride.landingInFuture'
    | 'ride.landingClosed'
    | 'ride.landingInvalid'
    | 'ride.landingFailed'
    | 'ride.signedOut'
    | 'ride.forbidden'
    | 'ride.notFound'

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('data' in error && typeof error.data === 'object' && error.data !== null && 'code' in error.data) {
    const code = error.data.code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function failureKey(error: unknown): LandingFailure {
  if (errorCode(error) === 'landing_time_in_future')
    return 'ride.landingInFuture'
  if (errorCode(error) === 'landing_time_closed')
    return 'ride.landingClosed'
  switch (httpStatus(error)) {
    case 401: return 'ride.signedOut'
    case 403: return 'ride.forbidden'
    case 404: return 'ride.notFound'
    default: return 'ride.landingFailed'
  }
}

/**
 * The clock reading is the Tenant zone. An empty field is not a clear:
 * clear is its own button, so Enter cannot wipe a stored time.
 */
function instantFromField(): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(wall.value)) {
    errorKey.value = 'ride.landingInvalid'
    return null
  }
  try {
    return instantFromWallClock(wall.value.slice(0, 16), props.timeZone).toISOString()
  }
  catch {
    errorKey.value = 'ride.landingInvalid'
    return null
  }
}

async function post(landingAt: string | null, mode: 'save' | 'clear') {
  if (pending.value)
    return
  pending.value = mode
  errorKey.value = null
  try {
    recordedLandingSchema.parse(await $fetch(`/api/rides/${props.rideId}/landing`, {
      method: 'POST',
      body: { landingAt },
    }))
    notifyAuditChanged()
    emit('saved')
  }
  catch (error) {
    errorKey.value = failureKey(error)
  }
  finally {
    pending.value = null
  }
}

function save() {
  const landingAt = instantFromField()
  if (landingAt === null)
    return
  void post(landingAt, 'save')
}

function clearLanding() {
  void post(null, 'clear')
}
</script>

<template>
  <!--
    The landing form lives in the Ride detail. A separate modal was one of
    the command surfaces ADR-0038 folds into that panel.
  -->
  <form
    :aria-labelledby="titleId"
    @submit.prevent="save"
  >
    <h2
      :id="titleId"
      class="mb-2 text-lg font-semibold"
    >
      {{ t('ride.recordLandingTitle') }}
    </h2>
    <p class="mb-4">
      {{ t('ride.recordLandingBody') }}
    </p>
    <p class="mb-4">
      {{ guestName }}
    </p>
    <UFormField
      :label="t('transfers.fields.landingAt')"
      name="landing"
      class="mb-4"
      :class="commandInputClass"
      :size="controlSize"
      :error="errorKey === 'ride.landingInvalid' ? t(errorKey) : false"
    >
      <UInput
        id="landing-time"
        v-model="wall"
        name="landing"
        type="datetime-local"
        class="w-full"
        :disabled="pending !== null"
        autofocus
        @keydown.enter.prevent="save"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UAlert
      v-if="errorKey && errorKey !== 'ride.landingInvalid'"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(errorKey)"
    />
    <div class="flex flex-wrap gap-2">
      <UButton
        v-if="landingAt"
        type="button"
        color="neutral"
        variant="outline"
        :size="controlSize"
        :class="controlClass"
        :loading="pending === 'clear'"
        :disabled="pending !== null"
        @click="clearLanding"
      >
        {{ pending === 'clear' ? t('ride.recordLandingClearing') : t('ride.recordLandingClear') }}
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :size="controlSize"
        :class="controlClass"
        :disabled="pending !== null"
        @click="emit('cancel')"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="submit"
        :size="controlSize"
        :class="controlClass"
        :loading="pending === 'save'"
        :disabled="pending !== null"
      >
        {{ pending === 'save' ? t('ride.recordLandingSaving') : t('ride.recordLandingSave') }}
      </UButton>
    </div>
  </form>
</template>
