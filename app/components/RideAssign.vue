<script setup lang="ts">
import type { Driver, TransferDayRide, Vehicle } from '../../shared'
import { assignedRideSchema, judgeSchedule, RELOCATION_GAP_DEFAULT_MINUTES, rosterVehicleSuggestionSchema, tenantSettingsGetSchema, TRANSFER_DURATION_DEFAULT_MINUTES } from '../../shared'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'

const props = defineProps<{
  rideId: string
  guestName: string
  drivers: Driver[]
  vehicles: Vehicle[]
  /**
   * Phone assignment is a list of Drivers, each with that day's roster
   * Vehicle and an overlap hint. Desktop keeps the two selects.
   */
  listDrivers?: boolean
  /** The day's Rides. The hint judges only this day; the server still confirms. */
  dayRides?: TransferDayRide[]
  pickupAt?: string
  landingAt?: string | null
  /** The Transfer version this form was opened with. ADR-0046. */
  version: number
  /** The Ride's Driver after Osvježi. Null while the Ride is unassigned. */
  rideDriverId: string | null
  /** The Ride's Vehicle after Osvježi. Null while the Ride is unassigned. */
  rideVehicleId: string | null
  /** Phone uses the large targets. Desktop uses the office size. */
  phone?: boolean
  /** 409 stale_save. Awaited so the notice is up before the button enables. */
  onStale: () => Promise<void>
}>()

const emit = defineEmits<{
  assigned: []
  cancel: []
}>()
const controlSize = computed(() => commandControlSize(props.phone === true))
const controlClass = computed(() => commandControlClass(props.phone === true))

const { t } = useI18n()
const toast = useToast()
const { present } = useWorkOrderPresenter()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()

const driverId = ref<string | undefined>()
const vehicleId = ref<string | undefined>()
const pending = ref(false)
const overlapOpen = ref(false)
const formErrorKey = ref<RideFailure | null>(null)
const rosterVehicleId = ref<string | null>(null)

const fromRoster = computed(() => rosterVehicleId.value !== null && vehicleId.value === rosterVehicleId.value)

// A slower roster read must not fill a vehicle for a driver the dispatcher has left.
let fillTicket = 0
// Osvježi writes the Ride's Driver. That write is not a new choice, so the roster pre-fill stays out.
// Set when Osvježi writes the opened Driver, so the roster watch does not pre-fill a Vehicle.
let applyingOpenedRide = false

type RideFailure
  = 'ride.driverArchived'
    | 'ride.vehicleArchived'
    | 'ride.notUnassigned'
    | 'ride.notFound'
    | 'ride.rejected'
    | 'ride.forbidden'
    | 'ride.signedOut'
    | 'ride.saveFailed'

// An archived Driver is not a new assignment (409 ride_driver_archived). Leave it off the picker.
const offerableDrivers = computed(() => props.drivers.filter(driver => driver.archivedAt === null))

const driverItems = computed(() => offerableDrivers.value.map(driver => ({
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

const rosterByDriver = ref<Record<string, string | null>>({})
const durationMinutes = ref(TRANSFER_DURATION_DEFAULT_MINUTES)
const gapMinutes = ref(RELOCATION_GAP_DEFAULT_MINUTES)

const occupying = computed(() => (props.dayRides ?? []).flatMap((ride) => {
  if ((ride.state !== 'assigned' && ride.state !== 'accepted') || ride.driverId === null || ride.vehicleId === null)
    return []
  return [{
    rideId: ride.rideId,
    pickupAt: new Date(ride.pickupAt),
    landingAt: ride.landingAt === null ? null : new Date(ride.landingAt),
    driverId: ride.driverId,
    vehicleId: ride.vehicleId,
  }]
}))

function plateFor(vehicleId: string | null): string {
  if (vehicleId === null)
    return ''
  return props.vehicles.find(vehicle => vehicle.id === vehicleId)?.registrationPlate ?? ''
}

function overlaps(driver: string, vehicle: string | null): boolean {
  if (vehicle === null || props.pickupAt === undefined)
    return false
  const verdict = judgeSchedule({
    rideId: props.rideId,
    pickupAt: new Date(props.pickupAt),
    landingAt: props.landingAt ? new Date(props.landingAt) : null,
    driverId: driver,
    vehicleId: vehicle,
  }, occupying.value, durationMinutes.value, gapMinutes.value)
  return verdict.overlaps.length > 0
}

function pickDriver(nextDriverId: string) {
  driverId.value = nextDriverId
}

onMounted(() => {
  if (!props.listDrivers)
    return
  void loadRosterHints()
})

async function loadRosterHints() {
  try {
    const settings = tenantSettingsGetSchema.parse(await $fetch('/api/tenant-settings'))
    durationMinutes.value = settings.transferDurationMinutes
    gapMinutes.value = settings.relocationGapMinutes
  }
  catch {
    // The hint uses the Tenant defaults when settings cannot be read.
  }
  await Promise.all(offerableDrivers.value.map(async (driver) => {
    try {
      const suggestion = rosterVehicleSuggestionSchema.parse(await $fetch(`/api/rides/${props.rideId}/roster-vehicle`, {
        query: { driverId: driver.id },
      }))
      rosterByDriver.value = { ...rosterByDriver.value, [driver.id]: suggestion.vehicleId }
    }
    catch {
      rosterByDriver.value = { ...rosterByDriver.value, [driver.id]: null }
    }
  }))
}

/**
 * The copy comes from `error.data.code`, the same way VehicleList reads a conflict.
 * The thrown message is never shown: it can carry an id or a stack.
 */
function failureKey(error: unknown): RideFailure {
  if (errorCode(error) === 'ride_driver_archived')
    return 'ride.driverArchived'
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

watch(() => props.version, (next, previous) => {
  if (previous === undefined || next === previous)
    return
  if ((props.rideDriverId ?? undefined) !== driverId.value)
    applyingOpenedRide = true
  driverId.value = props.rideDriverId ?? undefined
  vehicleId.value = props.rideVehicleId ?? undefined
  rosterVehicleId.value = null
})

watch(driverId, (next) => {
  if (applyingOpenedRide) {
    applyingOpenedRide = false
    return
  }
  const ticket = ++fillTicket
  // Capture before rosterVehicleId is cleared: fromRoster depends on it.
  // A roster pre-fill belongs to the previous driver, so drop it. A hand-picked
  // vehicle stays until the new roster answers, as before.
  if (fromRoster.value)
    vehicleId.value = undefined
  const snapshot = vehicleId.value
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

async function assign(confirm = false) {
  const chosenDriver = driverId.value
  const chosenVehicle = vehicleId.value
  formErrorKey.value = null
  if (!chosenDriver || !chosenVehicle)
    return
  pending.value = true
  try {
    const assigned = assignedRideSchema.parse(await $fetch(`/api/rides/${props.rideId}/assign`, {
      method: 'POST',
      body: {
        driverId: chosenDriver,
        vehicleId: chosenVehicle,
        version: props.version,
        ...(confirm ? { confirm: true } : {}),
      },
    }))
    overlapOpen.value = false
    notifyAuditChanged()
    if (assigned.relocationWarnings.length > 0) {
      toast.add({
        title: t('ride.tightGap'),
        color: 'warning',
      })
    }
    // The notice names the Driver by id. The name is the one already on
    // this form. The response has no address, so the toast cannot show one.
    const notice = assigned.workOrders[0]
    if (notice === undefined) {
      const savedNotice = { title: t('ride.assigned'), color: 'success' as const, role: 'status' }
      toast.add(savedNotice)
    }
    else {
      const driverName = props.drivers.find(driver => driver.id === notice.driverId)?.name ?? t('ride.unknownDriver')
      present(props.rideId, notice.outcome, driverName, t('ride.assigned'))
    }
    emit('assigned')
  }
  catch (error) {
    if (errorCode(error) === 'ride_overlap') {
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
    @submit.prevent="assign()"
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
    <ul
      v-if="listDrivers"
      class="mb-4 flex flex-col gap-2"
      :aria-label="t('ride.driver')"
    >
      <li
        v-for="driver in offerableDrivers"
        :key="driver.id"
      >
        <UButton
          type="button"
          color="neutral"
          :variant="driverId === driver.id ? 'solid' : 'outline'"
          size="xl"
          class="min-h-12 w-full justify-start"
          :disabled="pending"
          :aria-pressed="driverId === driver.id"
          @click="pickDriver(driver.id)"
        >
          <span class="flex min-w-0 flex-col items-start">
            <span>{{ driver.name }}</span>
            <span class="text-sm font-normal">
              <span class="font-mono">{{ plateFor(rosterByDriver[driver.id] ?? null) || t('ride.noRosterVehicle') }}</span>
              <span v-if="overlaps(driver.id, rosterByDriver[driver.id] ?? null)">
                · {{ t('ride.overlapHint') }}
              </span>
            </span>
          </span>
        </UButton>
      </li>
    </ul>
    <UFormField
      v-else
      :label="t('ride.driver')"
      name="assign-driver"
      class="mb-4"
      :class="commandInputClass"
      :size="controlSize"
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
      :class="commandInputClass"
      :size="controlSize"
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
        :size="controlSize"
        :class="controlClass"
        :disabled="pending || !canSubmit"
        :loading="pending"
      >
        {{ pending ? t('ride.submitting') : t('ride.submit') }}
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
    @confirm="assign(true)"
  />
</template>
