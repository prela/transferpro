<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DisplayLocale, Driver, Location, TransferDayRide, Vehicle } from '../../shared'
import { canCorrectTransfer, canRecordLandingTime, formatInstant } from '../../shared'
import { acceptByPhoneButtonId, assignButtonId, cancelRideButtonId, changeVehicleButtonId, clearRideButtonId, markDoneButtonId, markNoShowButtonId, reassignRideButtonId } from '../transfer-ride-buttons'
import { canCallOff, canChangeAssignment, canFinish, canNoShow, canRecordAcceptanceByPhone } from '../transfer-ride-guards'

const props = defineProps<{
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

/** The day list stores ids. The screen shows the name or the plate, never the id. */
function driverLabel(id: string | null): string {
  if (id === null)
    return ''
  return props.drivers.find(driver => driver.id === id)?.name ?? t('ride.unknownDriver')
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
        <time :datetime="row.original.pickupAt">
          {{ formatInstant(new Date(row.original.pickupAt), timeZone, locale) }}
        </time>
      </template>
      <template #landing-cell="{ row }">
        <time
          v-if="row.original.landingAt"
          :datetime="row.original.landingAt"
        >
          {{ formatInstant(new Date(row.original.landingAt), timeZone, locale) }}
        </time>
      </template>
      <template #expectedArrival-cell="{ row }">
        <time
          v-if="row.original.expectedArrival"
          :datetime="row.original.expectedArrival"
        >
          {{ formatInstant(new Date(row.original.expectedArrival), timeZone, locale) }}
        </time>
      </template>
      <template #tabla-cell="{ row }">
        <span v-if="row.original.tabla">{{ row.original.tabla }}</span>
      </template>
      <template #start-cell="{ row }">
        {{ placeLabel(row.original.startLocationId) }}
      </template>
      <template #end-cell="{ row }">
        {{ placeLabel(row.original.endLocationId) }}
      </template>
      <template #state-cell="{ row }">
        <span>{{ t(`transfers.states.${row.original.state}`) }}</span>
        <!--
          Text, not color. The alarm does not hide the row actions.
        -->
        <p
          v-if="row.original.landingAlarm"
          class="mt-1 whitespace-normal"
        >
          {{ t('officeHome.landingAlarm') }}
        </p>
        <!--
          Text, not color, and not the other Ride's guest. The warning
          does not hide the row actions.
        -->
        <p
          v-for="line in warningLines(row.original)"
          :key="line"
          class="mt-1 whitespace-normal"
        >
          {{ line }}
        </p>
      </template>
      <template #driver-cell="{ row }">
        {{ driverLabel(row.original.driverId) }}
      </template>
      <template #vehicle-cell="{ row }">
        <span>
          <span class="font-mono">{{ vehicleLabel(row.original.vehicleId) }}</span>
          <UBadge
            v-if="vehicleArchived(row.original.vehicleId)"
            color="neutral"
            variant="subtle"
            class="ml-2"
          >
            {{ t('vehicles.archived') }}
          </UBadge>
        </span>
      </template>
      <template #actions-header>
        <span class="sr-only">{{ t('ride.actions') }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex flex-wrap gap-2">
          <!--
            Correct is the only menu item. A finished Ride has no trigger.
            Assign and the other ride commands stay buttons beside it.
          -->
          <UDropdownMenu
            v-if="canCorrectTransfer(row.original.state)"
            :items="correctActions(row.original)"
            size="xl"
          >
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              icon="i-lucide-ellipsis-vertical"
              :aria-label="t('transfers.actionsFor', { guest: row.original.guestName })"
            />
          </UDropdownMenu>
          <UButton
            v-if="canRecordLandingTime(row.original.state)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="t('ride.recordLandingFor', { guest: row.original.guestName })"
            @click="emit('landing', row.original)"
          >
            {{ t('ride.recordLanding') }}
          </UButton>
          <UButton
            v-if="row.original.state === 'unassigned'"
            :id="assignButtonId(row.original.rideId)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="t('ride.assignFor', { guest: row.original.guestName })"
            @click="emit('assign', row.original)"
          >
            {{ t('ride.assign') }}
          </UButton>
          <!--
            Assigned and the copied flag, both. Accepted still has the flag
            and does not offer this. There is no note on the dialog.
          -->
          <UButton
            v-if="canRecordAcceptanceByPhone(row.original)"
            :id="acceptByPhoneButtonId(row.original.rideId)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="t('ride.acceptByPhoneFor', { guest: row.original.guestName })"
            @click="emit('acceptByPhone', row.original)"
          >
            {{ t('ride.acceptByPhone') }}
          </UButton>
          <UButton
            v-if="canCallOff(row.original)"
            :id="cancelRideButtonId(row.original.rideId)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="t('ride.cancelRideFor', { guest: row.original.guestName })"
            @click="emit('cancelRide', row.original)"
          >
            {{ t('ride.cancelRide') }}
          </UButton>
          <UButton
            v-if="canFinish(row.original)"
            :id="markDoneButtonId(row.original.rideId)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="t('ride.markDoneFor', { guest: row.original.guestName })"
            @click="emit('markDone', row.original)"
          >
            {{ t('ride.markDone') }}
          </UButton>
          <UButton
            v-if="canNoShow(row.original)"
            :id="markNoShowButtonId(row.original.rideId)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="t('ride.markNoShowFor', { guest: row.original.guestName })"
            @click="emit('markNoShow', row.original)"
          >
            {{ t('ride.markNoShow') }}
          </UButton>
          <template v-if="canChangeAssignment(row.original)">
            <UButton
              :id="changeVehicleButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.changeVehicleFor', { guest: row.original.guestName })"
              @click="emit('changeVehicle', row.original)"
            >
              {{ t('ride.changeVehicle') }}
            </UButton>
            <UButton
              :id="reassignRideButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.reassignFor', { guest: row.original.guestName })"
              @click="emit('reassign', row.original)"
            >
              {{ t('ride.reassign') }}
            </UButton>
            <UButton
              :id="clearRideButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.clearFor', { guest: row.original.guestName })"
              @click="emit('clear', row.original)"
            >
              {{ t('ride.clear') }}
            </UButton>
          </template>
        </div>
      </template>
    </UTable>
  </div>
</template>
