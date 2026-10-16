<script setup lang="ts">
import type { DisplayLocale, Location, TransferDayRide, Vehicle } from '../../shared'
import { formatInstant, groupDayPrint } from '../../shared'

const props = defineProps<{
  day: string
  /** Every Ride of the loaded day. Filters do not change the paper. */
  rides: TransferDayRide[]
  locations: Location[]
  vehicles: Vehicle[]
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()

const groups = computed(() => {
  const byId = new Map(props.rides.map(ride => [ride.rideId, ride]))
  return groupDayPrint(props.rides).flatMap((group) => {
    const rides = group.rideIds.flatMap((id) => {
      const ride = byId.get(id)
      return ride ? [ride] : []
    })
    return rides.length > 0 ? [{ vehicleId: group.vehicleId, rides }] : []
  })
})

function vehicleLabel(vehicleId: string | null): string {
  if (vehicleId === null)
    return t('transfers.printUnassigned')
  return props.vehicles.find(vehicle => vehicle.id === vehicleId)?.registrationPlate ?? t('ride.unknownVehicle')
}

function place(id: string): string {
  return props.locations.find(location => location.id === id)?.name ?? t('transfers.unknownPlace')
}

function clock(instant: string): string {
  return formatInstant(new Date(instant), props.timeZone, props.locale)
}
</script>

<template>
  <section
    class="transfer-day-print"
    :aria-label="t('transfers.printHeading', { day })"
  >
    <h1>{{ t('transfers.printHeading', { day }) }}</h1>
    <p v-if="groups.length === 0">
      {{ t('transfers.empty') }}
    </p>
    <section
      v-for="group in groups"
      :key="group.vehicleId ?? 'unassigned'"
    >
      <h2>{{ vehicleLabel(group.vehicleId) }}</h2>
      <table>
        <thead>
          <tr>
            <th>{{ t('transfers.columns.time') }}</th>
            <th>{{ t('transfers.columns.guest') }}</th>
            <th>{{ t('transfers.columns.route') }}</th>
            <th>{{ t('transfers.tabla') }}</th>
            <th>{{ t('transfers.note') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ride in group.rides"
            :key="ride.rideId"
          >
            <td>{{ clock(ride.pickupAt) }}</td>
            <td>{{ ride.guestName }}</td>
            <td>{{ place(ride.startLocationId) }} → {{ place(ride.endLocationId) }}</td>
            <td>{{ ride.tabla }}</td>
            <td>{{ ride.note }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
