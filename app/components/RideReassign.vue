<script setup lang="ts">
import type { Driver, Vehicle } from '../../shared'
import { rideSchema, rosterVehicleSuggestionSchema } from '../../shared'

const props = defineProps<{
  rideId: string
  guestName: string
  /** The Driver already on the Ride. The same Driver is not a reassignment. */
  driverId: string
  drivers: Driver[]
  vehicles: Vehicle[]
}>()

const emit = defineEmits<{
  saved: []
  cancel: []
}>()

const { t } = useI18n()
const toast = useToast()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()

const nextDriverId = ref<string | undefined>()
const vehicleId = ref<string | undefined>()
const pending = ref(false)
const formErrorKey = ref<RideFailure | null>(null)
const rosterVehicleId = ref<string | null>(null)

const fromRoster = computed(() => rosterVehicleId.value !== null && vehicleId.value === rosterVehicleId.value)

// A slower roster read must not fill a vehicle for a driver the dispatcher has left.
let fillTicket = 0

type RideFailure
  = 'ride.vehicleArchived'
    | 'ride.sameDriver'
    | 'ride.notOpen'
    | 'ride.notFound'
    | 'ride.rejected'
    | 'ride.forbidden'
    | 'ride.signedOut'
    | 'ride.changeFailed'

const driverItems = computed(() => props.drivers
  .filter(driver => driver.id !== props.driverId)
  .map(driver => ({
    label: driver.name,
    value: driver.id,
  })))

// An archived Vehicle is not a reassignment (409 ride_vehicle_archived). Leave it off the picker.
const vehicleItems = computed(() => props.vehicles
  .filter(vehicle => vehicle.archivedAt === null)
  .map(vehicle => ({
    label: vehicle.registrationPlate,
    value: vehicle.id,
  })))

const canSubmit = computed(() => Boolean(nextDriverId.value) && Boolean(vehicleId.value))

function failureKey(error: unknown): RideFailure {
  if (errorCode(error) === 'ride_vehicle_archived')
    return 'ride.vehicleArchived'
  if (errorCode(error) === 'ride_same_driver')
    return 'ride.sameDriver'
  if (errorCode(error) === 'ride_not_open')
    return 'ride.notOpen'
  switch (httpStatus(error)) {
    case 400: return 'ride.rejected'
    case 401: return 'ride.signedOut'
    case 403: return 'ride.forbidden'
    case 404: return 'ride.notFound'
    default: return 'ride.changeFailed'
  }
}

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

watch(nextDriverId, (next) => {
  const ticket = ++fillTicket
  if (fromRoster.value)
    vehicleId.value = undefined
  const snapshot = vehicleId.value
  rosterVehicleId.value = null
  formErrorKey.value = null
  if (!next)
    return
  void prefillVehicle(next, ticket, snapshot)
})

async function prefillVehicle(chosenDriverId: string, ticket: number, snapshot: string | undefined) {
  try {
    const suggestion = rosterVehicleSuggestionSchema.parse(await $fetch(`/api/rides/${props.rideId}/roster-vehicle`, {
      query: { driverId: chosenDriverId },
    }))
    if (ticket !== fillTicket)
      return
    // A vehicle chosen while this read was in flight stays. The roster is only the pre-fill.
    if (vehicleId.value !== snapshot)
      return
    const offered = vehicleItems.value.some(item => item.value === suggestion.vehicleId)
    if (offered && suggestion.vehicleId !== null) {
      vehicleId.value = suggestion.vehicleId
      rosterVehicleId.value = suggestion.vehicleId
    }
  }
  catch {
    // A failed pre-fill leaves the chosen vehicle and does not raise an error.
  }
}

async function submit() {
  const chosenDriver = nextDriverId.value
  const chosenVehicle = vehicleId.value
  formErrorKey.value = null
  if (!chosenDriver || !chosenVehicle)
    return
  pending.value = true
  try {
    rideSchema.parse(await $fetch(`/api/rides/${props.rideId}/reassign`, {
      method: 'POST',
      body: { driverId: chosenDriver, vehicleId: chosenVehicle },
    }))
    notifyAuditChanged()
    toast.add({ title: t('ride.reassigned'), color: 'success' })
    emit('saved')
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <form
    class="mt-6"
    :aria-labelledby="titleId"
    @submit.prevent="submit"
  >
    <h2
      :id="titleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t('ride.reassignTitle') }}
    </h2>
    <p class="mb-4">
      {{ guestName }}
    </p>
    <UAlert
      v-if="formErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(formErrorKey)"
    />
    <UFormField
      :label="t('ride.driver')"
      name="reassign-driver"
      class="mb-4"
      size="xl"
    >
      <USelect
        id="reassign-driver"
        v-model="nextDriverId"
        name="reassign-driver"
        :items="driverItems"
        :placeholder="t('ride.chooseDriver')"
        :disabled="pending"
        autofocus
        class="w-full"
      />
    </UFormField>
    <UFormField
      :label="t('ride.vehicle')"
      name="reassign-vehicle"
      class="mb-4"
      size="xl"
    >
      <USelect
        id="reassign-vehicle"
        v-model="vehicleId"
        name="reassign-vehicle"
        :items="vehicleItems"
        :placeholder="t('ride.chooseVehicle')"
        :disabled="pending"
        class="w-full"
      />
    </UFormField>
    <p
      v-if="fromRoster"
      class="mb-4 text-sm text-muted"
    >
      {{ t('ride.fromRoster') }}
    </p>
    <div class="flex flex-wrap gap-2">
      <UButton
        type="submit"
        size="xl"
        :disabled="pending || !canSubmit"
        :loading="pending"
      >
        {{ pending ? t('ride.reassigning') : t('ride.reassignSubmit') }}
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        :disabled="pending"
        @click="emit('cancel')"
      >
        {{ t('ride.cancel') }}
      </UButton>
    </div>
  </form>
</template>
