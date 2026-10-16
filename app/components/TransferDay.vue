<script setup lang="ts">
import type { DisplayLocale, LiveRefreshOutcome, TransferDayFilter, TransferDayRide } from '../../shared'
import { classifyRideAttention, clockLabel, isCalendarDate, operationalDateInTimeZone, parseTransferDayFilter, rideUrgentKeys, sevenDayUnassignedNote, transferDayFilterCounts, transferDayFilterMatches, transferDayPartyMatches, transferDaySearchMatches } from '../../shared'

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
const search = ref(queryText(route.query.search))
const clientId = ref<string | null>(queryText(route.query.client) || null)
const driverId = ref<string | null>(queryText(route.query.driver) || null)

const {
  day,
  rides,
  declineAlerts,
  clients,
  locations,
  drivers,
  vehicles,
  unassignedPickups,
  loading,
  loadError,
  loadDay,
  loadAll,
} = useTransferDayLoad(() => props.timeZone, () => props.operationalDayStartHour)

const queryDay = queryText(route.query.day)
if (isCalendarDate(queryDay))
  day.value = queryDay

function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

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

const operationalDay = computed(() =>
  operationalDateInTimeZone(props.timeZone, new Date(nowMs.value), props.operationalDayStartHour),
)

const unassignedNote = computed(() => sevenDayUnassignedNote(
  unassignedPickups.value,
  operationalDay.value,
  props.timeZone,
  props.operationalDayStartHour,
  props.locale,
))

const narrowedRides = computed(() => rides.value.filter(ride =>
  // The day row has no Client reference column. The predicate still matches one.
  transferDaySearchMatches(search.value, {
    guestName: ride.guestName,
    flightNumber: ride.flightNumber,
    clientReference: '',
    tabla: ride.tabla,
    clientId: ride.clientId,
    driverId: ride.driverId,
  }) && transferDayPartyMatches(clientId.value ?? '', driverId.value ?? '', ride),
))

const counts = computed(() => transferDayFilterCounts(
  narrowedRides.value.map(ride => ({
    rideId: ride.rideId,
    ride,
    declines: declinesFor(ride.rideId),
  })),
  nowMs.value,
))

const visibleRides = computed(() => narrowedRides.value.filter(ride =>
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

const ownedQuery = ['day', 'filter', 'search', 'client', 'driver']

function buildQuery(): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(route.query)) {
    if (ownedQuery.includes(key))
      continue
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
  if (filter.value !== 'all')
    query.filter = filter.value
  if (search.value.trim() !== '')
    query.search = search.value
  if (clientId.value)
    query.client = clientId.value
  if (driverId.value)
    query.driver = driverId.value
  return query
}

function queryValue(value: string | string[] | undefined): string {
  if (value === undefined)
    return ''
  return Array.isArray(value) ? value.join('\0') : value
}

function queryMatches(routeQuery: Record<string, string | string[]>): boolean {
  const current = buildQuery()
  const keys = new Set([...Object.keys(current), ...Object.keys(routeQuery)])
  for (const key of keys) {
    if (queryValue(current[key]) !== queryValue(routeQuery[key]))
      return false
  }
  return true
}

let syncing = false
let syncAgain = false

async function syncQuery() {
  if (syncing) {
    syncAgain = true
    return
  }
  syncing = true
  try {
    do {
      syncAgain = false
      const query = buildQuery()
      if (queryMatches(routeQueryRecord()))
        continue
      // Push, so Back returns the previous filters. Replace would drop them.
      await router.push({ query })
    } while (syncAgain)
  }
  finally {
    syncing = false
  }
}

function routeQueryRecord(): Record<string, string | string[]> {
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
  return query
}

function applyRouteQuery() {
  const nextFilter = parseTransferDayFilter(route.query.filter)
  const nextSearch = queryText(route.query.search)
  const nextClient = queryText(route.query.client) || null
  const nextDriver = queryText(route.query.driver) || null
  const nextDay = queryText(route.query.day)
  if (filter.value !== nextFilter)
    filter.value = nextFilter
  if (search.value !== nextSearch)
    search.value = nextSearch
  if (clientId.value !== nextClient)
    clientId.value = nextClient
  if (driverId.value !== nextDriver)
    driverId.value = nextDriver
  if (isCalendarDate(nextDay) && day.value !== nextDay)
    day.value = nextDay
}

watch(day, () => {
  commands.value?.onDayChanged()
  void syncQuery()
  void loadDay()
})

watch([filter, search, clientId, driverId], () => {
  void syncQuery()
})

watch(() => route.query, () => {
  // A push we just sent is not Back. Applying it would put a stale search
  // back into the field while the next filter change is still queued.
  if (syncing)
    return
  applyRouteQuery()
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
      v-model:search="search"
      v-model:client-id="clientId"
      v-model:driver-id="driverId"
      :counts="counts"
      :clients="clients"
      :drivers="drivers"
      :note="unassignedNote"
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
