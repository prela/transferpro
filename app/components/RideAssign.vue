<script setup lang="ts">
import type { Driver, Vehicle } from '../../shared'
import { rideSchema, rosterVehicleSuggestionSchema } from '../../shared'

const props = defineProps<{
  rideId: string
  guestName: string
  drivers: Driver[]
  vehicles: Vehicle[]
}>()

const emit = defineEmits<{
  assigned: []
  cancel: []
}>()

const { t } = useI18n()
const toast = useToast()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()

const driverId = ref<string | undefined>()
const vehicleId = ref<string | undefined>()
const pending = ref(false)
const formErrorKey = ref<RideFailure | null>(null)
const rosterVehicleId = ref<string | null>(null)

const fromRoster = computed(() => rosterVehicleId.value !== null && vehicleId.value === rosterVehicleId.value)

// A slower roster read must not fill a vehicle for a driver the dispatcher has left.
let fillTicket = 0

type RideFailure
  = 'ride.vehicleArchived'
    | 'ride.notUnassigned'
    | 'ride.notFound'
    | 'ride.rejected'
    | 'ride.forbidden'
    | 'ride.signedOut'
    | 'ride.saveFailed'

const driverItems = computed(() => props.drivers.map(driver => ({
  label: driver.name,
  value: driver.id,
})))

// An archived Vehicle is not an assignment (409 ride_vehicle_archived). Leave it off the picker.
const vehicleItems = computed(() => props.vehicles
  .filter(vehicle => vehicle.archivedAt === null)
  .map(vehicle => ({
    label: vehicle.registrationPlate,
    value: vehicle.id,
  })))

const canSubmit = computed(() => Boolean(driverId.value) && Boolean(vehicleId.value))

/**
 * The copy comes from `error.data.code`, the same way VehicleList reads a conflict.
 * The thrown message is never shown: it can carry an id or a stack.
 */
function failureKey(error: unknown): RideFailure {
  if (errorCode(error) === 'ride_vehicle_archived')
    return 'ride.vehicleArchived'
  if (errorCode(error) === 'ride_not_unassigned')
    return 'ride.notUnassigned'
  switch (httpStatus(error)) {
    case 400: return 'ride.rejected'
    case 401: return 'ride.signedOut'
    case 403: return 'ride.forbidden'
    case 404: return 'ride.notFound'
    default: return 'ride.saveFailed'
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

watch(driverId, (next) => {
  const ticket = ++fillTicket
  const snapshot = vehicleId.value
  // A new driver is not this hint. Keep the chosen vehicle until the roster answers.
  rosterVehicleId.value = null
  formErrorKey.value = null
  if (!next)
    return
  void prefillVehicle(next, ticket, snapshot)
})

async function prefillVehicle(nextDriverId: string, ticket: number, snapshot: string | undefined) {
  try {
    const suggestion = rosterVehicleSuggestionSchema.parse(await $fetch(`/api/rides/${props.rideId}/roster-vehicle`, {
      query: { driverId: nextDriverId },
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

async function assign() {
  const chosenDriver = driverId.value
  const chosenVehicle = vehicleId.value
  formErrorKey.value = null
  if (!chosenDriver || !chosenVehicle)
    return
  pending.value = true
  try {
    rideSchema.parse(await $fetch(`/api/rides/${props.rideId}/assign`, {
      method: 'POST',
      body: { driverId: chosenDriver, vehicleId: chosenVehicle },
    }))
    notifyAuditChanged()
    toast.add({ title: t('ride.assigned'), color: 'success' })
    emit('assigned')
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
    @submit.prevent="assign"
  >
    <h2
      :id="titleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t('ride.title') }}
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
      name="assign-driver"
      class="mb-4"
      size="xl"
    >
      <USelect
        id="assign-driver"
        v-model="driverId"
        name="assign-driver"
        :items="driverItems"
        :placeholder="t('ride.chooseDriver')"
        :disabled="pending"
        autofocus
        class="w-full"
      />
    </UFormField>
    <UFormField
      :label="t('ride.vehicle')"
      name="assign-vehicle"
      class="mb-4"
      size="xl"
    >
      <USelect
        id="assign-vehicle"
        v-model="vehicleId"
        name="assign-vehicle"
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
        {{ pending ? t('ride.submitting') : t('ride.submit') }}
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
