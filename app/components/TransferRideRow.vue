<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DisplayLocale, Driver, Location, TransferDayRide, Vehicle } from '../../shared'
import { canCorrectTransfer, canRecordLandingTime, formatInstant } from '../../shared'
import { driverDisplayName } from '../transfer-day-labels'
import { acceptByPhoneButtonId, assignButtonId, cancelRideButtonId, changeVehicleButtonId, clearRideButtonId, markDoneButtonId, markNoShowButtonId, reassignRideButtonId } from '../transfer-ride-buttons'
import { canCallOff, canChangeAssignment, canFinish, canNoShow, canRecordAcceptanceByPhone } from '../transfer-ride-guards'

const props = defineProps<{
  cell: 'pickup' | 'landing' | 'expectedArrival' | 'tabla' | 'start' | 'end' | 'state' | 'driver' | 'vehicle' | 'actions'
  ride: TransferDayRide
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

function placeLabel(id: string): string {
  return props.locations.find(location => location.id === id)?.name ?? t('transfers.unknownPlace')
}

function warningLines(ride: TransferDayRide): string[] {
  const lines: string[] = []
  if (ride.warnings.expiredDocuments.length > 0) {
    const documents = ride.warnings.expiredDocuments
      .map(kind => t(`expiringDocuments.kinds.${kind}`))
      .join(', ')
    lines.push(t('transfers.warnings.expiredDocuments', { documents }))
  }
  if (ride.warnings.rosterMismatch)
    lines.push(t('transfers.warnings.rosterMismatch'))
  if (ride.warnings.overlappingRideIds.length > 0)
    lines.push(t('transfers.warnings.overlap'))
  return lines
}

function vehicleLabel(id: string | null): string {
  if (id === null)
    return ''
  return props.vehicles.find(vehicle => vehicle.id === id)?.registrationPlate ?? t('ride.unknownVehicle')
}

function vehicleArchived(id: string | null): boolean {
  if (id === null)
    return false
  const vehicle = props.vehicles.find(item => item.id === id)
  return vehicle !== undefined && vehicle.archivedAt !== null
}

function correctActions(ride: TransferDayRide): DropdownMenuItem[][] {
  return [[
    {
      label: t('transfers.correct'),
      icon: 'i-lucide-pencil',
      onSelect: () => emit('correct', ride),
    },
  ]]
}
</script>

<template>
  <time
    v-if="cell === 'pickup'"
    :datetime="ride.pickupAt"
  >
    {{ formatInstant(new Date(ride.pickupAt), timeZone, locale) }}
  </time>
  <time
    v-else-if="cell === 'landing' && ride.landingAt"
    :datetime="ride.landingAt"
  >
    {{ formatInstant(new Date(ride.landingAt), timeZone, locale) }}
  </time>
  <time
    v-else-if="cell === 'expectedArrival' && ride.expectedArrival"
    :datetime="ride.expectedArrival"
  >
    {{ formatInstant(new Date(ride.expectedArrival), timeZone, locale) }}
  </time>
  <span v-else-if="cell === 'tabla' && ride.tabla">{{ ride.tabla }}</span>
  <template v-else-if="cell === 'start'">
    {{ placeLabel(ride.startLocationId) }}
  </template>
  <template v-else-if="cell === 'end'">
    {{ placeLabel(ride.endLocationId) }}
  </template>
  <template v-else-if="cell === 'state'">
    <span>{{ t(`transfers.states.${ride.state}`) }}</span>
    <!--
      Text, not color. The alarm does not hide the row actions.
    -->
    <p
      v-if="ride.landingAlarm"
      class="mt-1 whitespace-normal"
    >
      {{ t('officeHome.landingAlarm') }}
    </p>
    <!--
      Text, not color, and not the other Ride's guest. The warning
      does not hide the row actions.
    -->
    <p
      v-for="line in warningLines(ride)"
      :key="line"
      class="mt-1 whitespace-normal"
    >
      {{ line }}
    </p>
  </template>
  <template v-else-if="cell === 'driver'">
    {{ driverDisplayName(drivers, ride.driverId, t('ride.unknownDriver')) }}
  </template>
  <span v-else-if="cell === 'vehicle'">
    <span class="font-mono">{{ vehicleLabel(ride.vehicleId) }}</span>
    <UBadge
      v-if="vehicleArchived(ride.vehicleId)"
      color="neutral"
      variant="subtle"
      class="ml-2"
    >
      {{ t('vehicles.archived') }}
    </UBadge>
  </span>
  <div
    v-else-if="cell === 'actions'"
    class="flex flex-wrap gap-2"
  >
    <!--
      Correct is the only menu item. A finished Ride has no trigger.
      Assign and the other ride commands stay buttons beside it.
    -->
    <UDropdownMenu
      v-if="canCorrectTransfer(ride.state)"
      :items="correctActions(ride)"
      size="xl"
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        icon="i-lucide-ellipsis-vertical"
        :aria-label="t('transfers.actionsFor', { guest: ride.guestName })"
      />
    </UDropdownMenu>
    <UButton
      v-if="canRecordLandingTime(ride.state)"
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      :aria-label="t('ride.recordLandingFor', { guest: ride.guestName })"
      @click="emit('landing', ride)"
    >
      {{ t('ride.recordLanding') }}
    </UButton>
    <UButton
      v-if="ride.state === 'unassigned'"
      :id="assignButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      :aria-label="t('ride.assignFor', { guest: ride.guestName })"
      @click="emit('assign', ride)"
    >
      {{ t('ride.assign') }}
    </UButton>
    <!--
      Assigned and the copied flag, both. Accepted still has the flag
      and does not offer this. There is no note on the dialog.
    -->
    <UButton
      v-if="canRecordAcceptanceByPhone(ride)"
      :id="acceptByPhoneButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      :aria-label="t('ride.acceptByPhoneFor', { guest: ride.guestName })"
      @click="emit('acceptByPhone', ride)"
    >
      {{ t('ride.acceptByPhone') }}
    </UButton>
    <UButton
      v-if="canCallOff(ride)"
      :id="cancelRideButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      :aria-label="t('ride.cancelRideFor', { guest: ride.guestName })"
      @click="emit('cancelRide', ride)"
    >
      {{ t('ride.cancelRide') }}
    </UButton>
    <UButton
      v-if="canFinish(ride)"
      :id="markDoneButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      :aria-label="t('ride.markDoneFor', { guest: ride.guestName })"
      @click="emit('markDone', ride)"
    >
      {{ t('ride.markDone') }}
    </UButton>
    <UButton
      v-if="canNoShow(ride)"
      :id="markNoShowButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      :aria-label="t('ride.markNoShowFor', { guest: ride.guestName })"
      @click="emit('markNoShow', ride)"
    >
      {{ t('ride.markNoShow') }}
    </UButton>
    <template v-if="canChangeAssignment(ride)">
      <UButton
        :id="changeVehicleButtonId(ride.rideId)"
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        :aria-label="t('ride.changeVehicleFor', { guest: ride.guestName })"
        @click="emit('changeVehicle', ride)"
      >
        {{ t('ride.changeVehicle') }}
      </UButton>
      <UButton
        :id="reassignRideButtonId(ride.rideId)"
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        :aria-label="t('ride.reassignFor', { guest: ride.guestName })"
        @click="emit('reassign', ride)"
      >
        {{ t('ride.reassign') }}
      </UButton>
      <UButton
        :id="clearRideButtonId(ride.rideId)"
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        :aria-label="t('ride.clearFor', { guest: ride.guestName })"
        @click="emit('clear', ride)"
      >
        {{ t('ride.clear') }}
      </UButton>
    </template>
  </div>
</template>
