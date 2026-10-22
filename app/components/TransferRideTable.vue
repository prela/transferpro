<script setup lang="ts">
import type { Client, DisplayLocale, Driver, Location, Partner, TransferDayRide, Vehicle } from '../../shared'

const props = defineProps<{
  rides: TransferDayRide[]
  loading: boolean
  loadError: boolean
  locations: readonly Location[]
  drivers: Driver[]
  vehicles: Vehicle[]
  partners: Partner[]
  clients: Client[]
  declinesFor: (rideId: string) => { driverName: string }[]
  timeZone: string
  locale: DisplayLocale
  day: string
  nowMs: number
  filteredEmpty: boolean
}>()

const emit = defineEmits<{
  open: [ride: TransferDayRide]
  assign: [ride: TransferDayRide]
  landing: [ride: TransferDayRide]
  acceptByPhone: [ride: TransferDayRide]
  cancelRide: [ride: TransferDayRide]
  markDone: [ride: TransferDayRide]
  markNoShow: [ride: TransferDayRide]
  changeVehicle: [ride: TransferDayRide]
  reassign: [ride: TransferDayRide]
  clear: [ride: TransferDayRide]
  handOff: [ride: TransferDayRide]
  changePartner: [ride: TransferDayRide]
  takeBack: [ride: TransferDayRide]
  correct: [ride: TransferDayRide]
  duplicate: [ride: TransferDayRide]
  returnJourney: [ride: TransferDayRide]
  add: []
}>()

const { t } = useI18n()
const dayListRegion = ref<HTMLElement | null>(null)
// False until mount, so the server and the first client render agree.
// The phone list replaces the table after that, and button ids stay unique.
const phoneLayout = ref(false)

onMounted(() => {
  const query = window.matchMedia('(max-width: 1023px)')
  const apply = () => {
    phoneLayout.value = query.matches
  }
  apply()
  query.addEventListener('change', apply)
  onScopeDispose(() => query.removeEventListener('change', apply))
})

const clip = { class: { td: 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap', th: 'max-w-0' } }
const columns = computed(() => [
  { id: 'time', header: t('transfers.columns.time'), meta: { class: { td: 'whitespace-nowrap w-14', th: 'w-14' } } },
  { id: 'flight', header: t('transfers.columns.flight'), meta: clip },
  { id: 'guest', header: t('transfers.columns.guest'), meta: clip },
  { id: 'route', header: t('transfers.columns.route'), meta: clip },
  { id: 'client', header: t('transfers.columns.client'), meta: clip },
  { id: 'crew', header: t('transfers.columns.crew'), meta: clip },
  { id: 'state', header: t('transfers.columns.state'), meta: clip },
  { id: 'price', header: t('transfers.columns.price'), meta: { class: { td: 'whitespace-nowrap w-28', th: 'w-28' } } },
  { id: 'actions', header: '', meta: { class: { td: 'whitespace-nowrap w-48', th: 'w-48' } } },
])

const showSkeleton = computed(() => props.loading && props.rides.length === 0 && !props.loadError)
const showEmptyDay = computed(() => !props.loading && !props.loadError && props.rides.length === 0)

function focusList() {
  dayListRegion.value?.focus()
}

defineExpose({ focusList })

const shared = computed(() => ({
  locations: props.locations,
  drivers: props.drivers,
  vehicles: props.vehicles,
  partners: props.partners,
  clients: props.clients,
  timeZone: props.timeZone,
  locale: props.locale,
  day: props.day,
  nowMs: props.nowMs,
}))
</script>

<template>
  <div
    v-if="showSkeleton"
    class="flex flex-col gap-2"
    role="status"
    :aria-label="t('transfers.loading')"
  >
    <USkeleton
      v-for="row in 6"
      :key="row"
      class="h-9 w-full"
    />
  </div>
  <p v-else-if="filteredEmpty">
    {{ t('transfers.filterEmpty') }}
  </p>
  <div
    v-else-if="showEmptyDay"
    class="flex flex-col items-start gap-3"
  >
    <p>{{ t('transfers.empty') }}</p>
    <UButton
      type="button"
      size="sm"
      icon="i-lucide-plus"
      class="h-7 min-h-7 max-lg:h-11 max-lg:min-h-11"
      @click="emit('add')"
    >
      {{ t('shell.newTransfer') }}
    </UButton>
  </div>
  <div
    v-else-if="!loadError"
    ref="dayListRegion"
    class="focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
    role="region"
    :aria-label="t('transfers.title')"
    tabindex="0"
  >
    <UTable
      v-if="!phoneLayout"
      :data="rides"
      :columns="columns"
      :on-select="(_event, row) => emit('open', row.original)"
      :ui="{
        root: 'relative overflow-x-hidden',
        base: 'w-full table-fixed',
        th: 'px-2 py-1 text-xs font-semibold text-start',
        td: '!px-2 !py-1 text-sm leading-5 text-default align-middle',
        tr: 'h-9',
      }"
    >
      <template #time-cell="{ row }">
        <TransferRideRow
          cell="time"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #flight-cell="{ row }">
        <TransferRideRow
          cell="flight"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #guest-cell="{ row }">
        <TransferRideRow
          cell="guest"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #route-cell="{ row }">
        <TransferRideRow
          cell="route"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #client-cell="{ row }">
        <TransferRideRow
          cell="client"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #crew-cell="{ row }">
        <TransferRideRow
          cell="crew"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #state-cell="{ row }">
        <TransferRideRow
          cell="state"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #price-cell="{ row }">
        <TransferRideRow
          cell="price"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
        />
      </template>
      <template #actions-header>
        <span class="sr-only">{{ t('ride.actions') }}</span>
      </template>
      <template #actions-cell="{ row }">
        <TransferRideRow
          cell="actions"
          :ride="row.original"
          v-bind="shared"
          :declines="declinesFor(row.original.rideId)"
          @assign="emit('assign', $event)"
          @landing="emit('landing', $event)"
          @accept-by-phone="emit('acceptByPhone', $event)"
          @cancel-ride="emit('cancelRide', $event)"
          @mark-done="emit('markDone', $event)"
          @mark-no-show="emit('markNoShow', $event)"
          @change-vehicle="emit('changeVehicle', $event)"
          @reassign="emit('reassign', $event)"
          @clear="emit('clear', $event)"
          @hand-off="emit('handOff', $event)"
          @change-partner="emit('changePartner', $event)"
          @take-back="emit('takeBack', $event)"
          @open="emit('open', $event)"
          @correct="emit('correct', $event)"
          @duplicate="emit('duplicate', $event)"
          @return-journey="emit('returnJourney', $event)"
        />
      </template>
    </UTable>
    <ul
      v-else
      class="flex flex-col gap-2"
    >
      <li
        v-for="ride in rides"
        :key="ride.rideId"
      >
        <TransferRideRow
          cell="phone"
          :ride="ride"
          v-bind="shared"
          :declines="declinesFor(ride.rideId)"
          @assign="emit('assign', $event)"
          @landing="emit('landing', $event)"
          @accept-by-phone="emit('acceptByPhone', $event)"
          @cancel-ride="emit('cancelRide', $event)"
          @mark-done="emit('markDone', $event)"
          @mark-no-show="emit('markNoShow', $event)"
          @change-vehicle="emit('changeVehicle', $event)"
          @reassign="emit('reassign', $event)"
          @clear="emit('clear', $event)"
          @hand-off="emit('handOff', $event)"
          @change-partner="emit('changePartner', $event)"
          @take-back="emit('takeBack', $event)"
          @open="emit('open', $event)"
          @correct="emit('correct', $event)"
          @duplicate="emit('duplicate', $event)"
          @return-journey="emit('returnJourney', $event)"
        />
      </li>
    </ul>
  </div>
</template>
