<script setup lang="ts">
import type { CapacityRefusalReason, Driver, Vehicle } from '../../shared'
import { assignedRideSchema, capacityDialogReason, rosterVehicleSuggestionSchema } from '../../shared'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'

const props = defineProps<{
  rideId: string
  guestName: string
  /** The Driver already on the Ride. The same Driver is not a reassignment. */
  driverId: string
  /** The Transfer version this form was opened with. ADR-0046. */
  version: number
  drivers: Driver[]
  vehicles: Vehicle[]
  /** Phone uses the large targets. Desktop uses the office size. */
  phone?: boolean
  /** 409 stale_save. Awaited so the notice is up before the button enables. */
  onStale: () => Promise<void>
}>()

const emit = defineEmits<{
  saved: []
  cancel: []
}>()
const controlSize = computed(() => commandControlSize(props.phone === true))
const controlClass = computed(() => commandControlClass(props.phone === true))

const { t } = useI18n()
const toast = useToast()
const { present } = useWorkOrderPresenter()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()

const nextDriverId = ref<string | undefined>()
const vehicleId = ref<string | undefined>()
const pending = ref(false)
const refusalOpen = ref(false)
const refusalReason = ref<CapacityRefusalReason>('overlap')
const formErrorKey = ref<RideFailure | null>(null)
const rosterVehicleId = ref<string | null>(null)

const fromRoster = computed(() => rosterVehicleId.value !== null && vehicleId.value === rosterVehicleId.value)

// A slower roster read must not fill a vehicle for a driver the dispatcher has left.
let fillTicket = 0
// Osvježi clears the pending choice. That clear is not a new Driver, so the roster pre-fill stays out.
// Set when Osvježi clears the picker, so the roster watch does not pre-fill a Vehicle.
let applyingOpenedRide = false

type RideFailure
  = 'ride.vehicleArchived'
    | 'ride.driverArchived'
    | 'ride.sameDriver'
    | 'ride.notOpen'
    | 'ride.notFound'
    | 'ride.rejected'
    | 'ride.forbidden'
    | 'ride.signedOut'
    | 'ride.changeFailed'

// An archived Driver is not a reassignment (409 ride_driver_archived). Leave it off the picker.
const driverItems = computed(() => props.drivers
  .filter(driver => driver.id !== props.driverId && driver.archivedAt === null)
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

watch(() => props.version, (next, previous) => {
  // Osvježi replaced the opened version. The current Driver stays off this picker.
  if (previous === undefined || next === previous)
    return
  if (nextDriverId.value !== undefined)
    applyingOpenedRide = true
  nextDriverId.value = undefined
  vehicleId.value = undefined
  rosterVehicleId.value = null
})

function failureKey(error: unknown): RideFailure {
  if (errorCode(error) === 'ride_driver_archived')
    return 'ride.driverArchived'
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
  if (applyingOpenedRide) {
    applyingOpenedRide = false
    return
  }
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

async function submit(confirm = false) {
  const chosenDriver = nextDriverId.value
  const chosenVehicle = vehicleId.value
  formErrorKey.value = null
  if (!chosenDriver || !chosenVehicle)
    return
  pending.value = true
  try {
    const saved = assignedRideSchema.parse(await $fetch(`/api/rides/${props.rideId}/reassign`, {
      method: 'POST',
      body: {
        driverId: chosenDriver,
        vehicleId: chosenVehicle,
        version: props.version,
        ...(confirm ? { confirm: true } : {}),
      },
    }))
    refusalOpen.value = false
    notifyAuditChanged()
    if (saved.relocationWarnings.length > 0) {
      toast.add({
        title: t('ride.tightGap'),
        color: 'warning',
      })
    }
    // One result per Driver. The new Driver is first, then the previous one.
    // The response has no address, so neither the toast nor the detail can show one.
    for (const notice of saved.workOrders) {
      const name = props.drivers.find(driver => driver.id === notice.driverId)?.name ?? t('ride.unknownDriver')
      present(props.rideId, notice.outcome, name, t('ride.reassigned'))
    }
    emit('saved')
  }
  catch (error) {
    const reason = capacityDialogReason(errorCode(error))
    if (reason) {
      refusalReason.value = reason
      refusalOpen.value = true
      return
    }
    refusalOpen.value = false
    if (errorCode(error) === 'stale_save') {
      await props.onStale()
      return
    }
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
    @submit.prevent="submit()"
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
      :class="commandInputClass"
      :size="controlSize"
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
      :class="commandInputClass"
      :size="controlSize"
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
        :size="controlSize"
        :class="controlClass"
        :disabled="pending || !canSubmit"
        :loading="pending"
      >
        {{ pending ? t('ride.reassigning') : t('ride.reassignSubmit') }}
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :size="controlSize"
        :class="controlClass"
        :disabled="pending"
        @click="emit('cancel')"
      >
        {{ t('ride.cancel') }}
      </UButton>
    </div>
  </form>
  <RideOverlapDialog
    v-model:open="refusalOpen"
    :pending="pending"
    :reason="refusalReason"
    @confirm="submit(true)"
  />
</template>
