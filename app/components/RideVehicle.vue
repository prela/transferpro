<script setup lang="ts">
import type { CapacityDialogReason, Driver, Vehicle } from '../../shared'
import { assignedRideSchema, capacityDialogReason } from '../../shared'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'

const props = defineProps<{
  rideId: string
  guestName: string
  /** The Vehicle already on the Ride. It stays off the picker. */
  vehicleId: string
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

const nextVehicleId = ref<string | undefined>()
const pending = ref(false)
const overlapOpen = ref(false)
const confirmReason = ref<CapacityDialogReason>('overlap')
const formErrorKey = ref<RideFailure | null>(null)

type RideFailure
  = 'ride.vehicleArchived'
    | 'ride.vehicleUnchanged'
    | 'ride.notOpen'
    | 'ride.notFound'
    | 'ride.rejected'
    | 'ride.forbidden'
    | 'ride.signedOut'
    | 'ride.changeFailed'

// An archived Vehicle is not a change (409 ride_vehicle_archived). The current one is not a change either.
const vehicleItems = computed(() => props.vehicles
  .filter(vehicle => vehicle.archivedAt === null && vehicle.id !== props.vehicleId)
  .map(vehicle => ({
    label: vehicle.registrationPlate,
    value: vehicle.id,
  })))

const canSubmit = computed(() => Boolean(nextVehicleId.value))

watch(() => props.version, (next, previous) => {
  // Osvježi replaced the opened version. The pending vehicle is not the Ride's vehicle.
  if (previous === undefined || next === previous)
    return
  nextVehicleId.value = undefined
})

function failureKey(error: unknown): RideFailure {
  if (errorCode(error) === 'ride_vehicle_archived')
    return 'ride.vehicleArchived'
  if (errorCode(error) === 'ride_vehicle_unchanged')
    return 'ride.vehicleUnchanged'
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

async function submit(confirm = false) {
  const chosen = nextVehicleId.value
  formErrorKey.value = null
  if (!chosen)
    return
  pending.value = true
  try {
    const saved = assignedRideSchema.parse(await $fetch(`/api/rides/${props.rideId}/vehicle`, {
      method: 'POST',
      body: { vehicleId: chosen, version: props.version, ...(confirm ? { confirm: true } : {}) },
    }))
    overlapOpen.value = false
    notifyAuditChanged()
    if (saved.relocationWarnings.length > 0) {
      toast.add({
        title: t('ride.tightGap'),
        color: 'warning',
      })
    }
    // The notice names the Driver by id. The name is already on the day list.
    // The response has no address, so neither the toast nor the detail can show one.
    for (const notice of saved.workOrders) {
      const name = props.drivers.find(driver => driver.id === notice.driverId)?.name ?? t('ride.unknownDriver')
      present(props.rideId, notice.outcome, name, t('ride.vehicleChanged'))
    }
    emit('saved')
  }
  catch (error) {
    const reason = capacityDialogReason(errorCode(error))
    if (reason) {
      confirmReason.value = reason
      overlapOpen.value = true
      return
    }
    overlapOpen.value = false
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
      {{ t('ride.changeVehicleTitle') }}
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
      :label="t('ride.vehicle')"
      name="change-vehicle"
      class="mb-4"
      :class="commandInputClass"
      :size="controlSize"
    >
      <USelect
        id="change-vehicle"
        v-model="nextVehicleId"
        name="change-vehicle"
        :items="vehicleItems"
        :placeholder="t('ride.chooseVehicle')"
        :disabled="pending"
        autofocus
        class="w-full"
      />
    </UFormField>
    <div class="flex flex-wrap gap-2">
      <UButton
        type="submit"
        :size="controlSize"
        :class="controlClass"
        :disabled="pending || !canSubmit"
        :loading="pending"
      >
        {{ pending ? t('ride.changeVehicleSubmitting') : t('ride.changeVehicleSubmit') }}
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
    v-model:open="overlapOpen"
    :pending="pending"
    :reason="confirmReason"
    @confirm="submit(true)"
  />
</template>
