<script setup lang="ts">
import type { DisplayLocale, Driver, Location, OccupationStripBlock, RosterAssignment, TransferDayRide, Vehicle } from '../../shared'
import { clockLabel, formatInstant, locationLabel, occupationStripStorageKey, pickupNeedsCalendarDate, placeOccupationStrip, readOccupationStripCollapsed, rosterDaySchema, tenantSettingsGetSchema, writeOccupationStripCollapsed } from '../../shared'
import { driverDisplayName } from '../transfer-day-labels'

const props = defineProps<{
  day: string
  rides: TransferDayRide[]
  locations: Location[]
  drivers: Driver[]
  vehicles: Vehicle[]
  timeZone: string
  locale: DisplayLocale
  operationalDayStartHour: number
  nowMs: number
  tenantId: string
  userId: string
}>()

const emit = defineEmits<{
  open: [ride: TransferDayRide]
}>()

const { t } = useI18n()

const collapsed = ref(false)
// localStorage is read after mount so the server document and the first client render match.
const ready = ref(false)
const loaded = ref(false)
const failed = ref(false)
const durationMinutes = ref(60)
const gapMinutes = ref(15)
const assignments = ref<RosterAssignment[]>([])

let loadGeneration = 0

const placed = computed(() => {
  if (!loaded.value)
    return null
  return placeOccupationStrip({
    day: props.day,
    timeZone: props.timeZone,
    startHour: props.operationalDayStartHour,
    durationMinutes: durationMinutes.value,
    gapMinutes: gapMinutes.value,
    now: new Date(props.nowMs),
    // The table filters do not change who occupies a Vehicle.
    rides: props.rides,
    roster: assignments.value,
  })
})

const rows = computed(() => {
  const strip = placed.value
  if (!strip)
    return []
  return strip.rows
    .map(row => ({
      vehicleId: row.vehicleId,
      label: rowLabel(row.vehicleId, row.rosterDriverIds),
      blocks: row.blocks.flatMap(block => viewBlock(block)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, props.locale === 'hr' ? 'hr' : 'en'))
})

const ticks = computed(() => placed.value?.ticks ?? [])
const now = computed(() => placed.value?.now ?? null)
const nowLabel = computed(() => {
  if (now.value === null)
    return ''
  return t('transfers.occupation.now', {
    time: clockLabel(new Date(props.nowMs), props.timeZone, props.locale),
  })
})

function storageKey(): string {
  return occupationStripStorageKey(props.tenantId, props.userId)
}

function placeName(id: string): string {
  const found = props.locations.find(location => location.id === id)
  return found ? locationLabel(found) : t('transfers.unknownPlace')
}

function rowLabel(vehicleId: string, driverIds: readonly string[]): string {
  const plate = props.vehicles.find(vehicle => vehicle.id === vehicleId)?.registrationPlate
    ?? t('ride.unknownVehicle')
  if (driverIds.length === 0)
    return t('transfers.occupation.rowVehicle', { vehicle: plate })
  const driver = driverIds
    .map(id => driverDisplayName(props.drivers, id, t('ride.unknownDriver')))
    .join(', ')
  return t('transfers.occupation.row', { vehicle: plate, driver })
}

function clock(instant: string): string {
  if (pickupNeedsCalendarDate(instant, props.day, props.timeZone))
    return formatInstant(new Date(instant), props.timeZone, props.locale)
  return clockLabel(new Date(instant), props.timeZone, props.locale)
}

function viewBlock(block: OccupationStripBlock) {
  const ride = props.rides.find(item => item.rideId === block.rideId)
  if (!ride)
    return []
  const time = clock(ride.pickupAt)
  const passengers = t('transfers.passengersCount', { count: ride.passengerCount })
  const from = placeName(ride.startLocationId)
  const to = placeName(ride.endLocationId)
  const name = block.warning
    ? t('transfers.occupation.blockWarning', {
        time,
        passengers,
        from,
        to,
        warning: t('transfers.attention.overlap'),
      })
    : t('transfers.occupation.block', { time, passengers, from, to })
  return [{ ...block, ride, time, name }]
}

function hourLabel(hour: number): string {
  return String(hour).padStart(2, '0')
}

async function load(): Promise<void> {
  const current = ++loadGeneration
  const day = props.day
  try {
    const [settings, roster] = await Promise.all([
      $fetch('/api/tenant-settings').then(data => tenantSettingsGetSchema.parse(data)),
      $fetch('/api/roster', { query: { date: day }, cache: 'no-store' }).then(data => rosterDaySchema.parse(data)),
    ])
    if (current !== loadGeneration || day !== props.day)
      return
    durationMinutes.value = settings.transferDurationMinutes
    gapMinutes.value = settings.relocationGapMinutes
    assignments.value = roster.assignments
    failed.value = false
    loaded.value = true
  }
  catch {
    if (current !== loadGeneration)
      return
    failed.value = true
    loaded.value = false
  }
}

watch(collapsed, (value) => {
  if (!ready.value)
    return
  writeOccupationStripCollapsed(localStorage, storageKey(), value)
})

watch(() => [props.day, props.rides] as const, () => {
  if (ready.value)
    void load()
})

onMounted(() => {
  collapsed.value = readOccupationStripCollapsed(localStorage, storageKey())
  ready.value = true
  void load()
})
</script>

<template>
  <!-- Phone hides the strip. ADR-0038 allows this one exception. -->
  <section
    v-if="ready && (failed || rows.length > 0)"
    class="mb-3 hidden lg:block"
    :aria-label="t('transfers.occupation.region')"
  >
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      class="mb-2 h-7 min-h-7"
      :aria-expanded="!collapsed"
      aria-controls="occupation-strip"
      @click="collapsed = !collapsed"
    >
      {{ collapsed ? t('transfers.occupation.show') : t('transfers.occupation.hide') }}
    </UButton>
    <div
      v-show="!collapsed"
      id="occupation-strip"
    >
      <UAlert
        v-if="failed"
        color="error"
        variant="subtle"
        role="alert"
        :description="t('transfers.occupation.loadFailed')"
      />
      <div
        v-else
        class="overflow-hidden rounded-md border border-default"
      >
        <div class="grid grid-cols-[10rem_minmax(0,1fr)]">
          <div aria-hidden="true" />
          <div
            class="relative h-5 overflow-hidden border-b border-default"
            aria-hidden="true"
          >
            <span
              v-for="tick in ticks"
              :key="tick.left"
              class="absolute top-0.5 text-xs text-muted"
              :style="{ left: `${tick.left * 100}%` }"
            >{{ hourLabel(tick.hour) }}</span>
          </div>
          <template
            v-for="row in rows"
            :key="row.vehicleId"
          >
            <div
              class="flex items-center truncate border-t border-default px-2 text-xs text-default"
              :title="row.label"
            >
              {{ row.label }}
            </div>
            <div class="relative h-14 overflow-hidden border-t border-default">
              <div
                v-for="block in row.blocks"
                :key="block.rideId"
                class="absolute top-1 h-7"
                :style="{ left: `${block.left * 100}%`, width: `${block.width * 100}%` }"
              >
                <!-- Width is the occupation window. The caption sits under it and does not take clicks. -->
                <button
                  type="button"
                  class="size-full rounded-sm border bg-elevated"
                  :class="block.warning ? 'border-warning ring-1 ring-warning' : 'border-default'"
                  :aria-label="block.name"
                  @click="emit('open', block.ride)"
                />
                <span class="pointer-events-none absolute top-8 left-0 whitespace-nowrap text-xs text-default">
                  {{ block.time }}<template v-if="block.warning"> {{ t('transfers.attention.overlap') }}</template>
                </span>
              </div>
              <div
                v-if="now !== null"
                class="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary"
                :style="{ left: `${now * 100}%` }"
                aria-hidden="true"
              />
            </div>
          </template>
        </div>
        <p
          v-if="nowLabel"
          class="sr-only"
        >
          {{ nowLabel }}
        </p>
      </div>
    </div>
  </section>
</template>
