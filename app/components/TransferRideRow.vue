<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Client, DisplayLocale, Driver, Location, RideAttentionItem, TransferDayRide, Vehicle } from '../../shared'
import { canCorrectTransfer, canRecordLandingTime, classifyRideAttention, clockLabel, formatInstant, pickupNeedsCalendarDate, rideStateMark } from '../../shared'
import { driverDisplayName } from '../transfer-day-labels'
import { canCallOff, canChangeAssignment, canNoShow } from '../transfer-ride-guards'

const props = defineProps<{
  cell: 'phone' | 'time' | 'flight' | 'guest' | 'route' | 'client' | 'crew' | 'state' | 'price' | 'actions' | 'home'
  ride?: TransferDayRide
  locations?: Location[]
  drivers?: Driver[]
  vehicles?: Vehicle[]
  clients?: Client[]
  declines?: { driverName: string }[]
  timeZone: string
  locale: DisplayLocale
  day?: string
  nowMs?: number
  /** Office home card. The compact day row is the other mode. */
  summary?: {
    pickupAt: string
    guestName: string
    start: string
    end: string
    state: TransferDayRide['state']
    driverName: string | null
    vehiclePlate: string | null
    price: string
    payment: TransferDayRide['payment']
    flightNumber: string | null
    landingAt: string | null
    expectedArrival: string | null
    tabla: string
    unassignedAlarm?: boolean
    unclosedMark?: boolean
    landingAlarm?: boolean
  }
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
  duplicate: [ride: TransferDayRide]
  returnJourney: [ride: TransferDayRide]
  open: [ride: TransferDayRide]
}>()

const { t } = useI18n()

const controlClass = 'h-7 min-h-7 px-2 text-sm max-lg:h-11 max-lg:min-h-11 max-lg:px-3 max-lg:text-base'

const stateIcon = {
  unassigned: 'i-lucide-circle-dashed',
  waiting: 'i-lucide-phone',
  assigned: 'i-lucide-user',
  accepted: 'i-lucide-circle-check',
  inProgress: 'i-lucide-car',
  done: 'i-lucide-check',
  noShow: 'i-lucide-user-x',
  cancelled: 'i-lucide-ban',
} as const

function rideOf(): TransferDayRide {
  if (!props.ride)
    throw new Error('Ride row has no ride.')
  return props.ride
}

function place(id: string): Location | undefined {
  return props.locations?.find(location => location.id === id)
}

function placeLabel(id: string): string {
  return place(id)?.name ?? t('transfers.unknownPlace')
}

function attention(): RideAttentionItem[] {
  const ride = props.ride
  if (!ride)
    return []
  return classifyRideAttention(ride, props.declines ?? [], props.nowMs ?? Date.now())
}

function mark() {
  return rideStateMark(rideOf(), props.nowMs ?? Date.now())
}

function stateLabel(): string {
  const ride = rideOf()
  // Waiting is the only label that is not the stored state. In progress keeps
  // the stored word so a ride recorded at noon does not change name after noon.
  if (mark().key === 'waiting')
    return t('transfers.filters.waiting')
  return t(`transfers.states.${ride.state}`)
}

function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}

function clock(instant: string): string {
  return formatInstant(new Date(instant), props.timeZone, props.locale)
}

function vehicleLabel(id: string | null): string {
  if (id === null)
    return ''
  return props.vehicles?.find(vehicle => vehicle.id === id)?.registrationPlate ?? t('ride.unknownVehicle')
}

function vehicleArchived(id: string | null): boolean {
  if (id === null)
    return false
  const vehicle = props.vehicles?.find(item => item.id === id)
  return vehicle !== undefined && vehicle.archivedAt !== null
}

function crewText(): string {
  const ride = rideOf()
  if (ride.driverId === null)
    return t('transfers.unassignedCrew')
  const name = driverDisplayName(props.drivers ?? [], ride.driverId, t('ride.unknownDriver'))
  const plate = vehicleLabel(ride.vehicleId)
  return plate === '' ? name : `${name} · ${plate}`
}

function clientName(): string {
  const ride = props.ride
  if (!ride)
    return ''
  return props.clients?.find(client => client.id === ride.clientId)?.name ?? ''
}

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const ride = props.ride
  if (!ride)
    return []
  const items: DropdownMenuItem[] = []
  if (canCorrectTransfer(ride.state))
    items.push({ label: t('transfers.correct'), icon: 'i-lucide-pencil', onSelect: () => emit('correct', ride) })
  if (canRecordLandingTime(ride.state))
    items.push({ label: t('ride.recordLanding'), icon: 'i-lucide-plane-landing', onSelect: () => emit('landing', ride) })
  if (canCallOff(ride))
    items.push({ label: t('ride.cancelRide'), icon: 'i-lucide-ban', onSelect: () => emit('cancelRide', ride) })
  if (canNoShow(ride))
    items.push({ label: t('ride.markNoShow'), icon: 'i-lucide-user-x', onSelect: () => emit('markNoShow', ride) })
  if (canChangeAssignment(ride)) {
    items.push({ label: t('ride.changeVehicle'), icon: 'i-lucide-car', onSelect: () => emit('changeVehicle', ride) })
    items.push({ label: t('ride.reassign'), icon: 'i-lucide-arrow-left-right', onSelect: () => emit('reassign', ride) })
    items.push({ label: t('ride.clear'), icon: 'i-lucide-user-minus', onSelect: () => emit('clear', ride) })
  }
  // Both only open a new form. They stay available after the Ride is closed.
  items.push({ label: t('transfers.duplicate'), icon: 'i-lucide-copy', onSelect: () => emit('duplicate', ride) })
  items.push({ label: t('transfers.returnJourney'), icon: 'i-lucide-undo-2', onSelect: () => emit('returnJourney', ride) })
  return [items]
})
</script>

<template>
  <template v-if="cell === 'home' && summary">
    <h3 class="text-lg font-semibold">
      {{ summary.guestName }}
    </h3>
    <!--
      Home still uses its own sentences. The short row texts are the day table.
      The marks component is the shared one.
    -->
    <p
      v-if="summary.unassignedAlarm"
      class="mt-1"
    >
      {{ t('officeHome.unassignedAlarm') }}
    </p>
    <p
      v-if="summary.unclosedMark"
      class="mt-1"
    >
      {{ t('officeHome.unclosedMark') }}
    </p>
    <p
      v-if="summary.landingAlarm"
      class="mt-1"
    >
      {{ t('officeHome.landingAlarm') }}
    </p>
    <time
      class="mt-1 block"
      :datetime="summary.pickupAt"
    >
      {{ clock(summary.pickupAt) }}
    </time>
    <p class="mt-1">
      {{ summary.start }}
    </p>
    <p>{{ summary.end }}</p>
    <p>{{ t(`transfers.states.${summary.state}`) }}</p>
    <p>{{ t('ride.driver') }}: {{ summary.driverName ?? '—' }}</p>
    <p>
      {{ t('ride.vehicle') }}: <span class="font-mono">{{ summary.vehiclePlate ?? '—' }}</span>
    </p>
    <p class="tabular-nums">
      {{ priceLabel(summary.price) }}
    </p>
    <p>{{ t(`transfers.payments.${summary.payment}`) }}</p>
    <p v-if="summary.flightNumber">
      {{ t('transfers.fields.flightNumber') }}: <span class="font-mono">{{ summary.flightNumber }}</span>
    </p>
    <p v-if="summary.landingAt">
      <time :datetime="summary.landingAt">
        {{ t('transfers.fields.landingAt') }}: {{ clock(summary.landingAt) }}
      </time>
    </p>
    <p v-if="summary.expectedArrival">
      <time :datetime="summary.expectedArrival">
        {{ t('transfers.fields.expectedArrival') }}: {{ clock(summary.expectedArrival) }}
      </time>
    </p>
    <p v-if="summary.tabla">
      {{ t('transfers.fields.tabla') }}: {{ summary.tabla }}
    </p>
  </template>

  <div
    v-else-if="cell === 'phone' && ride"
    class="flex min-h-12 flex-col justify-center gap-1 py-1 text-sm"
    :class="mark().muted ? 'text-muted' : ''"
    tabindex="0"
    @click="emit('open', ride)"
    @keydown.enter.self.prevent="emit('open', ride)"
  >
    <div class="flex items-center gap-2">
      <time
        class="shrink-0 tabular-nums"
        :datetime="ride.pickupAt"
      >{{ clock(ride.pickupAt) }}</time>
      <span class="min-w-0 truncate font-medium">{{ ride.guestName }}</span>
      <span class="text-xs text-muted">{{ t('transfers.passengersCount', { count: ride.passengerCount }) }}</span>
      <span class="ms-auto shrink-0">
        <UBadge
          :color="mark().color"
          :variant="mark().variant"
          :icon="stateIcon[mark().key]"
          size="md"
          class="!text-sm"
          style="color: var(--ui-text)"
        >
          {{ stateLabel() }}
        </UBadge>
      </span>
    </div>
    <div class="flex min-w-0 items-center gap-2">
      <div class="min-w-0 flex-1">
        <span class="block truncate text-xs">
          {{ placeLabel(ride.startLocationId) }} → {{ placeLabel(ride.endLocationId) }} · {{ crewText() }}
        </span>
        <RideMarks
          :items="attention()"
          inline
        />
      </div>
      <TransferRideActions
        :ride="ride"
        :menu-items="menuItems"
        :control-class="`${controlClass}`"
        @assign="emit('assign', $event)"
        @accept-by-phone="emit('acceptByPhone', $event)"
        @mark-done="emit('markDone', $event)"
      />
    </div>
  </div>

  <time
    v-else-if="cell === 'time' && ride"
    class="tabular-nums"
    :datetime="ride.pickupAt"
  >
    {{ day && pickupNeedsCalendarDate(ride.pickupAt, day, timeZone) ? clock(ride.pickupAt) : clockLabel(new Date(ride.pickupAt), timeZone, locale) }}
  </time>

  <span
    v-else-if="cell === 'flight' && ride"
    class="block text-sm"
  >
    <span
      v-if="ride.flightNumber"
      class="font-mono"
    >{{ ride.flightNumber }}</span>
    <span
      v-if="ride.landingAt"
      class="block text-xs text-muted"
    >{{ t('transfers.landed', { time: clock(ride.landingAt) }) }}</span>
    <span
      v-else-if="ride.expectedArrival"
      class="block text-xs text-muted"
    >{{ t('transfers.expected', { time: clock(ride.expectedArrival) }) }}</span>
  </span>

  <span
    v-else-if="cell === 'guest' && ride"
    class="block"
  >
    <span>{{ ride.guestName }}</span>
    <span class="ms-1 text-xs text-muted">{{ t('transfers.passengersCount', { count: ride.passengerCount }) }}</span>
    <UIcon
      v-if="ride.luggageCount > 0"
      name="i-lucide-luggage"
      class="ms-1 inline size-3.5"
      :aria-label="t('transfers.luggageCount', { count: ride.luggageCount })"
    />
    <UIcon
      v-if="ride.childSeatCount > 0"
      name="i-lucide-baby"
      class="ms-1 inline size-3.5"
      :aria-label="t('transfers.childSeatCount', { count: ride.childSeatCount })"
    />
  </span>

  <span
    v-else-if="cell === 'route' && ride"
    class="block"
  >
    <UIcon
      v-if="place(ride.startLocationId)?.kind === 'airport' || place(ride.endLocationId)?.kind === 'airport'"
      name="i-lucide-plane"
      class="me-1 inline size-3.5"
      aria-hidden="true"
    />
    {{ placeLabel(ride.startLocationId) }} → {{ placeLabel(ride.endLocationId) }}
  </span>

  <span v-else-if="cell === 'client' && ride">{{ clientName() }}</span>

  <span
    v-else-if="cell === 'crew' && ride"
    :class="mark().muted ? 'text-muted' : ''"
  >
    <span class="sr-only">{{ t('transfers.columns.crew') }}: </span>
    {{ crewText() }}
    <span
      v-if="vehicleArchived(ride.vehicleId)"
      class="ms-1 text-xs"
    >{{ t('vehicles.archived') }}</span>
  </span>

  <span
    v-else-if="cell === 'state' && ride"
    class="block"
  >
    <UBadge
      :color="mark().color"
      :variant="mark().variant"
      :icon="stateIcon[mark().key]"
      size="md"
      :class="mark().muted ? '!text-sm opacity-70' : '!text-sm'"
      style="color: var(--ui-text)"
    >
      {{ stateLabel() }}
    </UBadge>
    <RideMarks
      class="mt-0.5"
      :items="attention()"
    />
  </span>

  <span
    v-else-if="cell === 'price' && ride"
    class="block text-end tabular-nums whitespace-nowrap"
  >
    {{ priceLabel(ride.price) }}
    <span class="ms-1 text-xs text-muted">{{ t(`transfers.payments.${ride.payment}`) }}</span>
  </span>

  <TransferRideActions
    v-else-if="cell === 'actions' && ride"
    :ride="ride"
    :menu-items="menuItems"
    :control-class="controlClass"
    @assign="emit('assign', $event)"
    @accept-by-phone="emit('acceptByPhone', $event)"
    @mark-done="emit('markDone', $event)"
  />
</template>
