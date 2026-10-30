<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Client, DisplayLocale, Driver, Location, Partner, RideAttentionItem, TransferDayRide, Vehicle } from '../../shared'
import { calendarDateInTimeZone, canAddExtraVehicle, canRecordLandingTime, classifyRideAttention, clockLabel, formatCalendarDate, formatInstant, locationLabel, officeCanCorrectTransfer, pickupNeedsCalendarDate, rideStateMark, transferGroupRole } from '../../shared'
import { driverDisplayName } from '../transfer-day-labels'
import { canCallOff, canChangeAssignment, canChangePartner, canHandOff, canNoShow, canTakeBack } from '../transfer-ride-guards'

const props = defineProps<{
  cell: 'phone' | 'time' | 'flight' | 'guest' | 'route' | 'client' | 'crew' | 'state' | 'price' | 'actions'
  ride?: TransferDayRide
  locations?: readonly Location[]
  drivers?: Driver[]
  vehicles?: Vehicle[]
  partners?: Partner[]
  clients?: Client[]
  declines?: { driverName: string }[]
  timeZone: string
  locale: DisplayLocale
  day?: string
  nowMs?: number
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
  handOff: [ride: TransferDayRide]
  changePartner: [ride: TransferDayRide]
  takeBack: [ride: TransferDayRide]
  correct: [ride: TransferDayRide]
  duplicate: [ride: TransferDayRide]
  returnJourney: [ride: TransferDayRide]
  extraVehicle: [ride: TransferDayRide]
  open: [ride: TransferDayRide]
}>()

const { t } = useI18n()

const controlClass = 'h-7 min-h-7 px-2 text-sm max-lg:h-11 max-lg:min-h-11 max-lg:px-3 max-lg:text-base'

const stateIcon = {
  unassigned: 'i-lucide-circle-dashed',
  waiting: 'i-lucide-phone',
  assigned: 'i-lucide-user',
  accepted: 'i-lucide-circle-check',
  handedOff: 'i-lucide-handshake',
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
  const found = place(id)
  return found ? locationLabel(found) : t('transfers.unknownPlace')
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

/** The pickup falls on a different calendar date than the day on screen. */
function namesCalendarDate(pickupAt: string): boolean {
  if (props.day === undefined)
    return false
  return pickupNeedsCalendarDate(pickupAt, props.day, props.timeZone)
}

function calendarDateLabel(pickupAt: string): string {
  const day = calendarDateInTimeZone(props.timeZone, new Date(pickupAt))
  return formatCalendarDate(day, props.locale)
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

function partnerLabel(id: string | null): string {
  if (id === null)
    return t('ride.unknownPartner')
  const partner = props.partners?.find(item => item.id === id)
  if (!partner)
    return t('ride.unknownPartner')
  return partner.archivedAt === null ? partner.name : `${partner.name} · ${t('partners.archived')}`
}

function crewText(): string {
  const ride = rideOf()
  // A handed-off Ride has no Driver. The unassigned label would be the wrong state.
  if (ride.state === 'handed_off')
    return partnerLabel(ride.partnerId)
  if (ride.driverId === null)
    return t('transfers.unassignedCrew')
  const name = driverDisplayName(props.drivers ?? [], ride.driverId, t('ride.unknownDriver'))
  const plate = vehicleLabel(ride.vehicleId)
  return plate === '' ? name : `${name} · ${plate}`
}

/** A main Transfer with a stored count, or an extra vehicle. An ordinary Transfer is not a group. */
function inGroup(): boolean {
  const ride = props.ride
  if (!ride)
    return false
  return transferGroupRole(
    ride.mainTransferId,
    ride.groupPassengerCountStored ? ride.groupPassengerCount : null,
  ) !== null
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
  if (officeCanCorrectTransfer(ride.state))
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
  if (canHandOff(ride))
    items.push({ label: t('ride.handOff'), icon: 'i-lucide-handshake', onSelect: () => emit('handOff', ride) })
  if (canChangePartner(ride))
    items.push({ label: t('ride.changePartner'), icon: 'i-lucide-handshake', onSelect: () => emit('changePartner', ride) })
  if (canTakeBack(ride))
    items.push({ label: t('ride.takeBack'), icon: 'i-lucide-corner-up-left', onSelect: () => emit('takeBack', ride) })
  // Adds a linked Transfer. The main Ride has to still be correctable.
  // On an extra vehicle this names that vehicle's main Transfer.
  if (canAddExtraVehicle(ride))
    items.push({ label: t('transfers.extraVehicle'), icon: 'i-lucide-car-front', onSelect: () => emit('extraVehicle', ride) })
  // Both only open a new form. They stay available after the Ride is closed.
  // An extra vehicle does not offer them: a Price of 0 must keep its link.
  if (ride.mainTransferId === null) {
    items.push({ label: t('transfers.duplicate'), icon: 'i-lucide-copy', onSelect: () => emit('duplicate', ride) })
    items.push({ label: t('transfers.returnJourney'), icon: 'i-lucide-undo-2', onSelect: () => emit('returnJourney', ride) })
  }
  return [items]
})
</script>

<template>
  <div
    v-if="cell === 'phone' && ride"
    class="flex min-h-12 flex-col justify-center gap-1 py-1 text-sm"
    :class="mark().muted ? 'text-muted' : ''"
    tabindex="0"
    @click="emit('open', ride)"
    @keydown.enter.self.prevent="emit('open', ride)"
  >
    <div class="flex min-w-0 items-center gap-2">
      <!--
        The date stacks under the clock. A full instant on this line
        squeezes the guest name to nothing on a phone.
      -->
      <span class="shrink-0 text-center leading-tight tabular-nums">
        <time
          class="block"
          :datetime="ride.pickupAt"
        >{{ clockLabel(new Date(ride.pickupAt), timeZone, locale) }}</time>
        <span
          v-if="namesCalendarDate(ride.pickupAt)"
          class="block text-xs text-muted"
        >{{ calendarDateLabel(ride.pickupAt) }}</span>
      </span>
      <!-- min-w-24 is the floor. flex-1 still truncates a long name. -->
      <span class="min-w-24 flex-1 truncate font-medium">{{ ride.guestName }}</span>
      <UBadge
        v-if="inGroup()"
        color="neutral"
        variant="subtle"
        size="sm"
        class="shrink-0"
        style="color: var(--ui-text)"
      >
        {{ t('transfers.group') }}
      </UBadge>
      <span class="shrink-0 text-xs text-muted">{{ t('transfers.passengersCount', { count: ride.passengerCount }) }}</span>
      <span class="shrink-0">
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
    {{ namesCalendarDate(ride.pickupAt) ? clock(ride.pickupAt) : clockLabel(new Date(ride.pickupAt), timeZone, locale) }}
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
    <UBadge
      v-if="inGroup()"
      color="neutral"
      variant="subtle"
      size="sm"
      class="me-1 align-middle"
      style="color: var(--ui-text)"
    >
      {{ t('transfers.group') }}
    </UBadge>
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
