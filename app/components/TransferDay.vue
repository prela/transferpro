<script setup lang="ts">
import type { DisplayLocale, LiveRefreshOutcome, TransferDayFilter, TransferDayRide } from '../../shared'
import type { RideDetailCommand, RideDetailLayout } from '../ride-detail'
import { classifyRideAttention, clockLabel, isCalendarDate, operationalDateInTimeZone, parseTransferDayFilter, rideUrgentKeys, sevenDayUnassignedNote, transferDayFilterCounts, transferDayFilterMatches, transferDayPartyMatches, transferDaySearchMatches } from '../../shared'
import { useKeptWorkOrders, useWorkOrderPresenter } from '../composables/kept-work-orders'
import { useRideDetailChrome } from '../composables/ride-detail-chrome'
import { rideDetailLayout } from '../ride-detail'
import { assignButtonId } from '../transfer-ride-buttons'
import { workOrderNotice } from '../work-order-notice'

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
const openRideId = ref<string | null>(queryText(route.query.ride) || null)
const command = ref<RideDetailCommand | null>(null)
const layout = ref<RideDetailLayout>('overlay')
const layoutReady = ref(false)
const { phoneDetailOpen } = useRideDetailChrome()
const { dismiss, kept } = useKeptWorkOrders()
const { takeHold } = useWorkOrderPresenter()
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
const listPane = ref<HTMLElement | null>(null)
const commands = ref<{
  openClear: (ride: TransferDayRide) => void
  openMarkDone: (ride: TransferDayRide) => void
  openMarkNoShow: (ride: TransferDayRide) => void
  openCancelRide: (ride: TransferDayRide) => void
} | null>(null)
const form = ref<{
  openAdd: () => void
  openCorrect: (ride: TransferDayRide) => void
  formMode: 'add' | 'edit' | null
  formOpen: boolean
  formTitle: string
} | null>(null)

let catalogsReady = false

function focusList() {
  table.value?.focusList()
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

const ownedQuery = ['day', 'filter', 'search', 'client', 'driver', 'ride']

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
  if (openRideId.value)
    query.ride = openRideId.value
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
  const nextRide = queryText(route.query.ride) || null
  if (openRideId.value !== nextRide) {
    openRideId.value = nextRide
    if (!nextRide)
      command.value = null
  }
}

watch(day, () => {
  command.value = null
  void syncQuery()
  void loadDay()
})

watch([filter, search, clientId, driverId, openRideId], () => {
  void syncQuery()
})

watch(rides, () => {
  if (loading.value || !openRideId.value)
    return
  if (!rides.value.some(ride => ride.rideId === openRideId.value)) {
    openRideId.value = null
    command.value = null
  }
})

/**
 * True after this screen sets the open Ride. A query push from the previous
 * close can arrive late and must not clear the Ride the user just opened.
 * Back clears the flag, so that navigation still applies.
 */
let rideOwnedLocally = false

function onHistoryBack() {
  rideOwnedLocally = false
  applyRouteQuery()
}

watch(() => route.query, () => {
  // A push we just sent is not Back. Applying it would put a stale search
  // back into the field while the next filter change is still queued.
  if (syncing)
    return
  const nextRide = queryText(route.query.ride) || null
  if (rideOwnedLocally && nextRide !== openRideId.value) {
    void syncQuery()
    return
  }
  applyRouteQuery()
})

function goToday() {
  day.value = operationalDateInTimeZone(props.timeZone, new Date(), props.operationalDayStartHour)
}

const openRide = computed(() => rides.value.find(ride => ride.rideId === openRideId.value) ?? null)

const pageNotices = computed(() => {
  if (openRide.value)
    return []
  return kept.value
})

function closeForm() {
  if (form.value?.formMode === 'edit')
    form.value.formOpen = false
}

/** Where the phone list was scrolled before the full-screen detail covered it. */
let phoneListScroll: { element: HTMLElement | null, top: number } = { element: null, top: 0 }

function scrollParent(start: HTMLElement | null): HTMLElement | null {
  let node = start?.parentElement ?? null
  while (node) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1)
      return node
    node = node.parentElement
  }
  return null
}

function rememberPhoneScroll() {
  if (layout.value !== 'phone')
    return
  const element = scrollParent(listPane.value)
  phoneListScroll = {
    element,
    top: element ? element.scrollTop : window.scrollY,
  }
}

function restorePhoneScroll() {
  if (layout.value !== 'phone')
    return
  const { element, top } = phoneListScroll
  // The slideover locks scroll while it is open. Restore after it releases.
  void nextTick(() => {
    requestAnimationFrame(() => {
      if (element)
        element.scrollTop = top
      else
        window.scrollTo(0, top)
    })
  })
}

function closeDetail() {
  closeForm()
  command.value = null
  openRideId.value = null
}

function backFromDetail() {
  closeForm()
  command.value = null
  void router.back()
}

let openTimer = 0

function showRide(ride: TransferDayRide, next: RideDetailCommand | null) {
  rememberPhoneScroll()
  closeForm()
  window.clearTimeout(openTimer)
  // The row menu closes on the next tick and returns focus. A detail opened
  // in that same turn is an outside press and dismisses itself.
  openTimer = window.setTimeout(() => {
    command.value = next
    openRideId.value = ride.rideId
  }, 0)
}

function focusDetail() {
  void nextTick(() => {
    document.getElementById('ride-detail')?.focus()
  })
}

function onCommand(next: RideDetailCommand | null) {
  const ride = openRide.value
  if (next === 'correct' && ride) {
    showRide(ride, 'correct')
    return
  }
  // Cancel of assign or accept-by-phone returns to the facts. The detail stays.
  if (next === null && (command.value === 'accept' || command.value === 'assign')) {
    command.value = null
    focusDetail()
    return
  }
  if (command.value === 'correct' && next !== 'correct')
    closeForm()
  command.value = next
}

function onDetailOpen(open: boolean) {
  if (open || openRideId.value === null)
    return
  if (layout.value === 'phone')
    backFromDetail()
  else
    closeDetail()
}

async function onCommandSaved() {
  const ride = openRide.value
  const wasAssign = command.value === 'assign'
  // No email and send failed keep the detail, with the warning inside it.
  const stay = takeHold()
  command.value = null
  await loadDay()
  if (stay) {
    focusDetail()
    return
  }
  const assignedId = ride?.rideId
  closeDetail()
  if (!wasAssign || !assignedId)
    return
  await nextTick()
  const start = rides.value.findIndex(item => item.rideId === assignedId)
  const from = start === -1 ? 0 : start + 1
  const wrapped = [...rides.value.slice(from), ...rides.value.slice(0, from)]
  const nextId = wrapped.find(item => item.state === 'unassigned')?.rideId
  if (nextId)
    document.getElementById(assignButtonId(nextId))?.focus()
  else
    focusList()
}

watch(corrected, (value) => {
  if (!value)
    return
  command.value = null
  if (takeHold()) {
    focusDetail()
    return
  }
  closeDetail()
})

watch([layout, openRideId], () => {
  phoneDetailOpen.value = layout.value === 'phone' && openRideId.value !== null
})

watch(openRideId, (id, previous) => {
  rideOwnedLocally = true
  if (!id && previous)
    restorePhoneScroll()
  // Opening pushes a new history entry. Writing the Ride onto the current
  // entry would make Back return to a list address that still has ?ride=.
  if (id)
    return
  const url = new URL(window.location.href)
  url.searchParams.delete('ride')
  const next = `${url.pathname}${url.search}${url.hash}`
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next)
    history.replaceState(history.state, '', next)
})

onMounted(() => {
  const phoneQuery = window.matchMedia('(max-width: 1023px)')
  const besideQuery = window.matchMedia('(min-width: 1440px)')
  const apply = () => {
    layout.value = rideDetailLayout(window.innerWidth)
  }
  apply()
  layoutReady.value = true
  window.addEventListener('popstate', onHistoryBack)
  phoneQuery.addEventListener('change', apply)
  besideQuery.addEventListener('change', apply)
  onScopeDispose(() => {
    window.removeEventListener('popstate', onHistoryBack)
    phoneQuery.removeEventListener('change', apply)
    besideQuery.removeEventListener('change', apply)
  })
})

onUnmounted(() => {
  window.clearTimeout(openTimer)
  phoneDetailOpen.value = false
})
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
    <UAlert
      v-for="notice in pageNotices"
      :key="notice.id"
      role="alert"
      :color="notice.outcome === 'failed' ? 'error' : 'warning'"
      variant="subtle"
      class="mb-3"
      :title="notice.actionTitle"
      :close="true"
      :description="t(workOrderNotice(notice.outcome).key, { name: notice.driverName })"
      :ui="{ title: '!text-default !opacity-100', description: '!text-default !opacity-100' }"
      @update:open="(open: boolean) => { if (!open) dismiss(notice.id) }"
    />
    <div class="flex items-start gap-4">
      <div
        id="transfer-day-list"
        ref="listPane"
        class="min-w-0 flex-1"
      >
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
          @open="showRide($event, null)"
          @assign="showRide($event, 'assign')"
          @landing="showRide($event, 'landing')"
          @accept-by-phone="showRide($event, 'accept')"
          @cancel-ride="ride => commands?.openCancelRide(ride)"
          @mark-done="ride => commands?.openMarkDone(ride)"
          @mark-no-show="ride => commands?.openMarkNoShow(ride)"
          @change-vehicle="showRide($event, 'vehicle')"
          @reassign="showRide($event, 'reassign')"
          @clear="ride => commands?.openClear(ride)"
          @correct="showRide($event, 'correct')"
          @add="form?.openAdd()"
        />
      </div>
      <UDashboardPanel
        v-if="layoutReady && layout === 'beside' && openRide"
        :ui="{ root: '!min-h-0 !h-auto !w-[420px] !max-w-[420px] !flex-none shrink-0 border-s border-default' }"
      >
        <template #body>
          <div>
            <TransferRideDetail
              v-model:day="day"
              v-model:saved="saved"
              v-model:corrected="corrected"
              v-model:locations="locations"
              :ride="openRide"
              :command="command"
              :drivers="drivers"
              :vehicles="vehicles"
              :clients="clients"
              :declines="declinesFor(openRide.rideId)"
              :time-zone="timeZone"
              :locale="locale"
              :now-ms="nowMs"
              :day-rides="rides"
              :list-drivers="false"
              :pin-actions="false"
              :operational-day-start-hour="operationalDayStartHour"
              :tenant-id="tenantId"
              :load-day="async () => { await loadDay() }"
              @command="onCommand"
              @close="closeDetail"
              @back="backFromDetail"
              @done="commands?.openMarkDone(openRide)"
              @no-show="commands?.openMarkNoShow(openRide)"
              @cancel-ride="commands?.openCancelRide(openRide)"
              @clear="commands?.openClear(openRide)"
              @saved="onCommandSaved"
            />
          </div>
        </template>
      </UDashboardPanel>
    </div>

    <USlideover
      v-if="layoutReady && layout !== 'beside' && openRide"
      :open="true"
      :title="command === 'correct' ? t('transfers.correctTitle') : openRide.guestName"
      :dismissible="false"
      :overlay="false"
      :modal="layout === 'phone'"
      :ui="layout === 'phone'
        ? { content: 'pointer-events-auto z-[60] w-screen max-w-none', body: 'flex flex-col', footer: 'p-3' }
        : { content: 'pointer-events-auto z-[60] w-[420px] max-w-[420px]' }"
      @update:open="onDetailOpen"
    >
      <template #body>
        <TransferRideDetail
          v-model:day="day"
          v-model:saved="saved"
          v-model:corrected="corrected"
          v-model:locations="locations"
          :ride="openRide"
          :command="command"
          :drivers="drivers"
          :vehicles="vehicles"
          :clients="clients"
          :declines="declinesFor(openRide.rideId)"
          :time-zone="timeZone"
          :locale="locale"
          :now-ms="nowMs"
          :day-rides="rides"
          :list-drivers="layout === 'phone'"
          :pin-actions="layout === 'phone'"
          :operational-day-start-hour="operationalDayStartHour"
          :tenant-id="tenantId"
          :load-day="async () => { await loadDay() }"
          @command="onCommand"
          @close="closeDetail"
          @back="backFromDetail"
          @done="commands?.openMarkDone(openRide)"
          @no-show="commands?.openMarkNoShow(openRide)"
          @clear="commands?.openClear(openRide)"
          @cancel-ride="commands?.openCancelRide(openRide)"
          @saved="onCommandSaved"
        />
      </template>
    </USlideover>

    <TransferRideCommands
      ref="commands"
      :drivers="drivers"
      :load-day="async () => { await loadDay() }"
      @saved="closeDetail"
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
