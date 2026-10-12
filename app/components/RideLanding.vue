<script setup lang="ts">
import { instantFromWallClock, recordedLandingSchema, wallClockInTimeZone } from '../../shared'

const props = defineProps<{
  rideId: string
  guestName: string
  /** The stored instant, or null when the Transfer has no landing time yet. */
  landingAt: string | null
  timeZone: string
}>()

const emit = defineEmits<{
  saved: []
  cancel: []
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const open = ref(true)
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

function onOpen(next: boolean) {
  // Dismiss writes nothing. A save in flight keeps the dialog up.
  if (!next && !pending.value)
    emit('cancel')
  else
    open.value = true
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
  <UModal
    v-model:open="open"
    :title="t('ride.recordLandingTitle')"
    :description="t('ride.recordLandingBody')"
    :dismissible="!pending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    @update:open="onOpen"
  >
    <template #body>
      <p class="mb-4">
        {{ guestName }}
      </p>
      <form @submit.prevent="save">
        <UFormField
          :label="t('transfers.fields.landingAt')"
          name="landing"
          class="mb-4"
          size="xl"
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
      </form>
    </template>
    <template #footer>
      <UButton
        v-if="landingAt"
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
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
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="pending !== null"
        @click="emit('cancel')"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="pending === 'save'"
        :disabled="pending !== null"
        @click="save"
      >
        {{ pending === 'save' ? t('ride.recordLandingSaving') : t('ride.recordLandingSave') }}
      </UButton>
    </template>
  </UModal>
</template>
