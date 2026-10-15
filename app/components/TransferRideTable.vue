<script setup lang="ts">
import type { DisplayLocale, Driver, Location, TransferDayRide, Vehicle } from '../../shared'

defineProps<{
  rides: TransferDayRide[]
  loading: boolean
  loadError: boolean
  locations: Location[]
  drivers: Driver[]
  vehicles: Vehicle[]
  timeZone: string
  locale: DisplayLocale
}>()

const emit = defineEmits<{
  assign: [ride: TransferDayRide]
  landing: [ride: TransferDayRide]
  acceptByPhone: [ride: TransferDayRide]
  cancelRide: [ride: TransferDayRide]
  markDone: [ride: TransferDayRide]
  markNoShow: [ride: TransferDayRide]
  changeVehicle: [ride: TransferDayRide]
  reassign: [ride: TransferDayRide]
  clear: [ride: TransferDayRide]
  correct: [ride: TransferDayRide]
}>()

const { t } = useI18n()
const dayListRegion = ref<HTMLElement | null>(null)

// Reserved ride states are labeled. This screen does not set them.
const columns = computed(() => [
  { id: 'pickup', header: t('transfers.pickupAt') },
  { id: 'landing', header: t('transfers.fields.landingAt') },
  { id: 'expectedArrival', header: t('transfers.fields.expectedArrival') },
  { accessorKey: 'guestName' as const, header: t('transfers.guest') },
  { id: 'tabla', header: t('transfers.tabla') },
  { id: 'start', header: t('transfers.start') },
  { id: 'end', header: t('transfers.end') },
  { id: 'state', header: t('transfers.status') },
  { id: 'driver', header: t('ride.driver') },
  { id: 'vehicle', header: t('ride.vehicle') },
  { id: 'actions', header: t('ride.actions') },
])

function focusList() {
  dayListRegion.value?.focus()
}

defineExpose({ focusList })
</script>

<template>
  <p
    v-if="loading"
    role="status"
  >
    {{ t('transfers.loading') }}
  </p>
  <p v-else-if="!loadError && rides.length === 0">
    {{ t('transfers.empty') }}
  </p>
  <div
    v-else-if="!loadError"
    ref="dayListRegion"
    class="overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
    role="region"
    :aria-label="t('transfers.title')"
    tabindex="0"
  >
    <UTable
      :data="rides"
      :columns="columns"
      class="whitespace-nowrap"
    >
      <template #pickup-cell="{ row }">
        <TransferRideRow
          cell="pickup"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #landing-cell="{ row }">
        <TransferRideRow
          cell="landing"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #expectedArrival-cell="{ row }">
        <TransferRideRow
          cell="expectedArrival"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #tabla-cell="{ row }">
        <TransferRideRow
          cell="tabla"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #start-cell="{ row }">
        <TransferRideRow
          cell="start"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #end-cell="{ row }">
        <TransferRideRow
          cell="end"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #state-cell="{ row }">
        <TransferRideRow
          cell="state"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #driver-cell="{ row }">
        <TransferRideRow
          cell="driver"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #vehicle-cell="{ row }">
        <TransferRideRow
          cell="vehicle"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
        />
      </template>
      <template #actions-header>
        <span class="sr-only">{{ t('ride.actions') }}</span>
      </template>
      <template #actions-cell="{ row }">
        <TransferRideRow
          cell="actions"
          :ride="row.original"
          :locations="locations"
          :drivers="drivers"
          :vehicles="vehicles"
          :time-zone="timeZone"
          :locale="locale"
          @assign="emit('assign', $event)"
          @landing="emit('landing', $event)"
          @accept-by-phone="emit('acceptByPhone', $event)"
          @cancel-ride="emit('cancelRide', $event)"
          @mark-done="emit('markDone', $event)"
          @mark-no-show="emit('markNoShow', $event)"
          @change-vehicle="emit('changeVehicle', $event)"
          @reassign="emit('reassign', $event)"
          @clear="emit('clear', $event)"
          @correct="emit('correct', $event)"
        />
      </template>
    </UTable>
  </div>
</template>
