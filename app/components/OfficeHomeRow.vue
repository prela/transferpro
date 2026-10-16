<script setup lang="ts">
import type { DisplayLocale, OfficeHomeBlockRide } from '../../shared'
import { clockLabel, formatInstant, operationalDateInTimeZone, pickupNeedsCalendarDate } from '../../shared'

const props = defineProps<{
  ride: OfficeHomeBlockRide
  timeZone: string
  locale: DisplayLocale
  operationalDate: string
  operationalDayStartHour: number
}>()

const { t } = useI18n()
const router = useRouter()

const controlClass = 'h-7 min-h-7 px-2 text-sm max-lg:h-11 max-lg:min-h-11 max-lg:px-3 max-lg:text-base'

const actionLabel = computed(() => {
  if (props.ride.action === 'assign')
    return t('ride.assign')
  if (props.ride.action === 'accept')
    return t('transfers.rowAccept')
  return t('transfers.rowDone')
})

const href = computed(() => {
  const day = operationalDateInTimeZone(props.timeZone, new Date(props.ride.pickupAt), props.operationalDayStartHour)
  return { path: '/transfers', query: { day, ride: props.ride.rideId } }
})

const when = computed(() => {
  const instant = new Date(props.ride.pickupAt)
  if (pickupNeedsCalendarDate(props.ride.pickupAt, props.operationalDate, props.timeZone))
    return formatInstant(instant, props.timeZone, props.locale)
  return clockLabel(instant, props.timeZone, props.locale)
})

const crew = computed(() => {
  if (!props.ride.driverName)
    return t('transfers.unassignedCrew')
  return props.ride.vehiclePlate ? `${props.ride.driverName} · ${props.ride.vehiclePlate}` : props.ride.driverName
})

function open() {
  void router.push(href.value)
}
</script>

<template>
  <!--
    Same two lines as the Transfers phone row (ADR-0038). The snapshot
    already joined the names, so this row does not look up catalog ids.
  -->
  <div class="flex items-center gap-2 py-1">
    <button
      type="button"
      class="min-w-0 flex-1 text-start text-sm"
      @click="open"
    >
      <span class="flex items-center gap-2">
        <time
          class="shrink-0 tabular-nums"
          :datetime="ride.pickupAt"
        >{{ when }}</time>
        <span class="min-w-0 truncate font-medium">{{ ride.guestName }}</span>
        <span class="text-xs text-muted">{{ t('transfers.passengersCount', { count: ride.passengerCount }) }}</span>
      </span>
      <span class="mt-0.5 block truncate text-xs">
        {{ ride.start }} → {{ ride.end }} · {{ ride.clientName }} · {{ crew }}
      </span>
      <RideMarks
        :items="ride.marks.map(mark => ({ tier: 'urgent', kind: mark.kind, driverName: mark.driverName }))"
        inline
      />
    </button>
    <UButton
      :to="href"
      color="neutral"
      variant="outline"
      size="sm"
      :class="controlClass"
      :aria-label="`${actionLabel}: ${ride.guestName}`"
    >
      {{ actionLabel }}
    </UButton>
  </div>
</template>
