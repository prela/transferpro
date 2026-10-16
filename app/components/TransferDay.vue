<script setup lang="ts">
import type { DisplayLocale, LiveRefreshOutcome, TransferDayFilter, TransferDayRide } from '../../shared'
import { classifyRideAttention, clockLabel, isCalendarDate, operationalDateInTimeZone, parseTransferDayFilter, rideUrgentKeys, transferDayFilterCounts, transferDayFilterMatches } from '../../shared'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  operationalDayStartHour: number
  tenantId: string
}>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const saved = ref(false)
const corrected = ref(false)
const nowMs = ref(Date.now())
const announcedCount = ref(0)
const filter = ref<TransferDayFilter>(parseTransferDayFilter(route.query.filter))

const {
  day,
  rides,
  declineAlerts,
  clients,
  locations,
  drivers,
  vehicles,
  loading,
  loadError,
  loadDay,
  loadAll,
} = useTransferDayLoad(() => props.timeZone, () => props.operationalDayStartHour)

const queryDay = typeof route.query.day === 'string' ? route.query.day : ''
if (isCalendarDate(queryDay))
  day.value = queryDay

const table = ref<{ focusList: () => void } | null>(null)
const commands = ref<{
  openAssign: (ride: TransferDayRide) => void
  openLanding: (ride: TransferDayRide) => void
  openVehicleChange: (ride: TransferDayRide) => void
  openReassign: (ride: TransferDayRide) => void
  openClear: (ride: TransferDayRide) => void
  openAcceptByPhone: (ride: TransferDayRide) => void
  openMarkDone: (ride: TransferDayRide) => void
  openMarkNoShow: (ride: TransferDayRide) => void
  openCancelRide: (ride: TransferDayRide) => void
  onDayChanged: () => void
} | null>(null)
const form = ref<{ openAdd: () => void, openCorrect: (ride: TransferDayRide) => void } | null>(null)

let catalogsReady = false

function focusList() {
  table.value?.focusList()
}

function loadFailed() {
  return loadError.value
}

function declinesFor(rideId: string): { driverName: string }[] {
  return declineAlerts.value
    .filter(alert => alert.rideId === rideId)
    .map(alert => ({ driverName: alert.driverName }))
}

const counts = computed(() => transferDayFilterCounts(
  rides.value.map(ride => ({
    rideId: ride.rideId,
    ride,
    declines: declinesFor(ride.rideId),
  })),
  nowMs.value,
))

const visibleRides = computed(() => rides.value.filter(ride =>
  transferDayFilterMatches(filter.value, ride, declinesFor(ride.rideId), nowMs.value),
))

const filteredEmpty = computed(() =>
  !loading.value && !loadError.value && rides.value.length > 0 && visibleRides.value.length === 0,
)

const announcement = computed(() =>
  announcedCount.value > 0 ? t('liveRefresh.newUrgent') : '',
)

function urgentKeys(): string[] {
  const keys: string[] = []
  for (const ride of rides.value) {
    const items = classifyRideAttention(ride, declinesFor(ride.rideId), nowMs.value)
    keys.push(...rideUrgentKeys(ride.rideId, items))
  }
  return keys
}

async function reload(): Promise<LiveRefreshOutcome> {
  nowMs.value = Date.now()
  if (!catalogsReady) {
    const outcome = await loadAll()
    if (outcome === 'ok')
      catalogsReady = true
    return outcome
  }
  return loadDay()
}

const { automatic, refreshing, updatedAt, failed, refresh } = useLiveRefresh({
  reload,
  urgentKeys,
  async onAnnounce(count) {
    if (count === 0) {
      announcedCount.value = 0
      return
    }
    announcedCount.value = 0
    await nextTick()
    announcedCount.value = count
  },
})

const shownTime = computed(() =>
  updatedAt.value === null ? '' : clockLabel(updatedAt.value, props.timeZone, props.locale),
)

async function syncQuery() {
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(route.query)) {
    if (typeof value === 'string') {
      query[key] = value
    }
    else if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string')
      if (strings.length > 0)
        query[key] = strings
    }
  }
  query.day = day.value
  if (filter.value === 'all')
    delete query.filter
  else
    query.filter = filter.value
  if (route.query.day === query.day && (route.query.filter ?? undefined) === query.filter)
    return
  await router.replace({ query })
}

watch(day, () => {
  commands.value?.onDayChanged()
  void syncQuery()
  void loadDay()
})

watch(filter, () => {
  void syncQuery()
})

function goToday() {
  day.value = operationalDateInTimeZone(props.timeZone, new Date(), props.operationalDayStartHour)
}
</script>

<template>
  <section>
    <TransferDayToolbar
      v-model:day="day"
      v-model:filter="filter"
      :counts="counts"
      @today="goToday"
      @add="form?.openAdd()"
    />
    <div
      class="mb-3 flex flex-wrap items-center gap-3"
      :aria-busy="refreshing"
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        class="h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base"
        @click="refresh"
      >
        {{ t('liveRefresh.refresh') }}
      </UButton>
      <p
        v-if="updatedAt"
        class="text-sm text-muted"
      >
        {{ failed ? t('liveRefresh.failed', { time: shownTime }) : t('liveRefresh.updatedAt', { time: shownTime }) }}
      </p>
      <UIcon
        v-if="refreshing"
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-muted motion-reduce:animate-none"
        aria-hidden="true"
      />
      <USwitch
        v-model="automatic"
        size="sm"
        class="max-lg:min-h-11"
        :label="t('liveRefresh.automatic')"
        :ui="{ label: 'max-lg:text-base' }"
      />
    </div>
    <p
      class="sr-only"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ announcement }}
    </p>
    <UAlert
      v-if="clients.length === 0 && !loading"
      color="neutral"
      variant="subtle"
      class="mb-4"
      :description="t('transfers.noClients')"
    />
    <UAlert
      v-if="saved"
      color="success"
      variant="subtle"
      role="status"
      class="mb-4"
      :description="t('transfers.recorded')"
    />
    <UAlert
      v-if="corrected"
      color="success"
      variant="subtle"
      role="status"
      class="mb-4"
      :description="t('transfers.corrected')"
    />

    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t('transfers.loadFailed')"
    />
    <TransferRideTable
      ref="table"
      :rides="visibleRides"
      :loading="loading"
      :load-error="loadError"
      :locations="locations"
      :drivers="drivers"
      :vehicles="vehicles"
      :clients="clients"
      :declines-for="declinesFor"
      :time-zone="timeZone"
      :locale="locale"
      :day="day"
      :now-ms="nowMs"
      :filtered-empty="filteredEmpty"
      @assign="ride => commands?.openAssign(ride)"
      @landing="ride => commands?.openLanding(ride)"
      @accept-by-phone="ride => commands?.openAcceptByPhone(ride)"
      @cancel-ride="ride => commands?.openCancelRide(ride)"
      @mark-done="ride => commands?.openMarkDone(ride)"
      @mark-no-show="ride => commands?.openMarkNoShow(ride)"
      @change-vehicle="ride => commands?.openVehicleChange(ride)"
      @reassign="ride => commands?.openReassign(ride)"
      @clear="ride => commands?.openClear(ride)"
      @correct="ride => form?.openCorrect(ride)"
      @add="form?.openAdd()"
    />

    <TransferRideCommands
      ref="commands"
      :rides="rides"
      :drivers="drivers"
      :vehicles="vehicles"
      :time-zone="timeZone"
      :load-failed="loadFailed"
      :load-day="async () => { await loadDay() }"
      :focus-list="focusList"
    />

    <TransferForm
      ref="form"
      v-model:day="day"
      v-model:saved="saved"
      v-model:corrected="corrected"
      v-model:locations="locations"
      :time-zone="timeZone"
      :locale="locale"
      :operational-day-start-hour="operationalDayStartHour"
      :tenant-id="tenantId"
      :clients="clients"
      :drivers="drivers"
      :load-day="async () => { await loadDay() }"
    />
  </section>
</template>
