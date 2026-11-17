<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { SevenDayUnassignedPart, TransferBoardFilter, TransferDayFilter, TransferDayHeaderTagKey, TransferDayRideStateFilter } from '../../shared'
import { addCalendarDays, fieldFilterCount, filterSummaryTags, isCalendarDate, readTransferDayFiltersCollapsed, TRANSFER_DAY_FILTERS, transferDayFiltersStorageKey, writeTransferDayFiltersCollapsed } from '../../shared'

const props = defineProps<{
  counts: Record<TransferDayFilter, number>
  toInvoiceCount: number
  /** False until this day's first successful load. Chips then omit the number. */
  countsReady: boolean
  hiddenUrgent: number
  /** Rides the sheet's "Prikaži vožnje" reports. */
  shownCount: number
  clients: { id: string, name: string }[]
  drivers: { id: string, name: string }[]
  vehicles: { id: string, name: string }[]
  partners: { id: string, name: string }[]
  note: readonly SevenDayUnassignedPart[]
  tenantId: string
  userId: string
  timeZone: string
  refreshing: boolean
  /** Already translated. Empty until a refresh has finished at least once. */
  updatedLabel: string
}>()

const emit = defineEmits<{
  today: []
  focusList: []
  refresh: []
  print: []
  /** Clears filters and keeps the view. The empty state clears both. */
  clearAttributes: []
}>()

const day = defineModel<string>('day', { required: true })
const filter = defineModel<TransferBoardFilter>('filter', { required: true })
const search = defineModel<string>('search', { required: true })
const clientId = defineModel<string | null>('clientId', { required: true })
const driverId = defineModel<string | null>('driverId', { required: true })
const vehicleId = defineModel<string | null>('vehicleId', { required: true })
const partnerId = defineModel<string | null>('partnerId', { required: true })
const rideState = defineModel<TransferDayRideStateFilter | ''>('rideState', { required: true })
const needsAttention = defineModel<boolean>('needsAttention', { required: true })
const automatic = defineModel<boolean>('automatic', { required: true })

const { t } = useI18n()

const dayFieldId = 'transfer-day'
const searchFieldId = 'transfer-day-search'
const filtersButtonId = 'transfer-day-filters-button'
const toolsButtonId = 'transfer-day-tools'
const hiddenUrgentId = 'transfer-day-hidden-urgent'

const controlClass = 'h-7 min-h-7 px-2 text-sm tabular-nums max-lg:h-11 max-lg:min-h-11 max-lg:text-base'

/**
 * False until mount, so the server document and the first client render match.
 * The phone sheet is mounted only after that. Until then the fields sit inline
 * and `max-lg:hidden` keeps them off a phone, so the sheet does not flash them.
 */
const phone = ref(false)
/** Desktop disclosure. Open until localStorage says this user collapsed it. */
const filtersOpen = ref(true)
const sheetOpen = ref(false)
/** Esc and × return to Filtri. "Prikaži vožnje" returns to the list. */
const sheetCloseFocus = ref<'filters' | 'list'>('filters')
const viewRow = ref<HTMLElement | null>(null)
const exportDialog = ref<{ openExport: () => void } | null>(null)
/**
 * Pinned only once the row has reached the top of the scrolling panel.
 * A sticky row is trapped by the header, and a bar that is fixed from the
 * start covers the day controls. The anchor keeps the gap while it is pinned.
 */
const stickyStyle = ref<Record<string, string>>({})
const searchAnchor = ref<HTMLElement | null>(null)
let scrollTarget: HTMLElement | null = null

const chipViews = new Set<string>([...TRANSFER_DAY_FILTERS, 'toInvoice'])

const headerState = computed(() => ({
  search: search.value,
  clientId: clientId.value,
  driverId: driverId.value,
  vehicleId: vehicleId.value,
  partnerId: partnerId.value,
  rideState: rideState.value,
  needsAttention: needsAttention.value,
  view: filter.value,
}))

const fieldCount = computed(() => fieldFilterCount(headerState.value))

const filtersButtonLabel = computed(() =>
  fieldCount.value === 0
    ? t('transfers.filterFields')
    : t('transfers.filterFieldsCount', { count: fieldCount.value }),
)

const tags = computed(() => filterSummaryTags(headerState.value, {
  search: t('transfers.daySearch'),
  client: t('transfers.columns.client'),
  driver: t('transfers.driver'),
  vehicle: t('transfers.vehicle'),
  partner: t('transfers.partner'),
  rideState: t('transfers.rideState'),
  needsAttention: t('transfers.needsAttention'),
  attentionValue: t('transfers.attentionYes'),
  unknownClient: t('transfers.unknownClient'),
  unknownDriver: t('ride.unknownDriver'),
  unknownVehicle: t('ride.unknownVehicle'),
  unknownPartner: t('ride.unknownPartner'),
  rideStateValue: rideStateLabel,
}, {
  clients: props.clients,
  drivers: props.drivers,
  vehicles: props.vehicles,
  partners: props.partners,
}))

const extraView = computed(() => chipViews.has(filter.value) ? null : filter.value)

const showHiddenUrgent = computed(() => props.countsReady && props.hiddenUrgent > 0)

const filtersExpanded = computed(() => phone.value ? sheetOpen.value : filtersOpen.value)

const filtersControls = computed(() => phone.value ? 'transfer-day-filter-sheet' : 'transfer-day-filters')

const toolItems = computed<DropdownMenuItem[][]>(() => [[
  {
    label: t('transfers.printDay'),
    icon: 'i-lucide-printer',
    onSelect: () => emit('print'),
  },
  {
    label: t('transfers.exportCsv'),
    icon: 'i-lucide-download',
    onSelect: () => exportDialog.value?.openExport(),
  },
]])

function rideStateLabel(value: string): string {
  if (value === 'assigned')
    return t('transfers.rideStates.assigned')
  if (value === 'handedOff')
    return t('transfers.states.handed_off')
  return t(`transfers.filters.${value}`)
}

function chipText(name: string, count: number): string {
  return props.countsReady ? `${name} (${count})` : name
}

function extraName(view: string): string {
  if (view === 'assignedNotStarted')
    return t('officeHome.assignedNotStarted')
  if (view === 'handedOff')
    return t('transfers.states.handed_off')
  if (view === 'done')
    return t('transfers.states.done')
  if (view === 'noShow')
    return t('transfers.states.no-show')
  if (view === 'cancelled')
    return t('transfers.states.cancelled')
  if (view === 'awaitingPartner')
    return t('officeHome.awaitingPartner')
  return view
}

function shift(delta: number) {
  if (!isCalendarDate(day.value))
    return
  day.value = addCalendarDays(day.value, delta)
}

function storageKey(): string {
  return transferDayFiltersStorageKey(props.tenantId, props.userId)
}

function onFiltersClick() {
  if (phone.value) {
    sheetCloseFocus.value = 'filters'
    sheetOpen.value = true
    return
  }
  filtersOpen.value = !filtersOpen.value
  writeTransferDayFiltersCollapsed(localStorage, storageKey(), !filtersOpen.value)
}

function onSheetOpen(open: boolean) {
  sheetOpen.value = open
  if (open)
    sheetCloseFocus.value = 'filters'
}

/**
 * The dialog would otherwise focus its container. The first field is the
 * Client menu. Closing returns to Filtri, except "Prikaži vožnje", which
 * returns to the list the office came to see.
 * Focus has to wait until the dialog has left. Restoring it while the
 * focus trap is still up drops the focus, and Esc then lands nowhere.
 */
function onSheetOpenAutoFocus(event: Event) {
  event.preventDefault()
  document.getElementById('transfer-day-client')?.focus()
}

function onSheetCloseAutoFocus(event: Event) {
  event.preventDefault()
}

function restoreSheetFocus() {
  const target = sheetCloseFocus.value
  sheetCloseFocus.value = 'filters'
  if (target === 'list') {
    emit('focusList')
    return
  }
  document.getElementById(filtersButtonId)?.focus()
}

function showRides() {
  sheetCloseFocus.value = 'list'
  sheetOpen.value = false
}

function clearTag(key: TransferDayHeaderTagKey, index: number) {
  if (key === 'search')
    search.value = ''
  else if (key === 'client')
    clientId.value = null
  else if (key === 'driver')
    driverId.value = null
  else if (key === 'vehicle')
    vehicleId.value = null
  else if (key === 'partner')
    partnerId.value = null
  else if (key === 'rideState')
    rideState.value = ''
  else
    needsAttention.value = false
  // The removed button is gone. The tag that slid into its place is next.
  void nextTick(() => {
    const buttons = document.querySelectorAll<HTMLElement>('[data-filter-remove]')
    const next = buttons[index] ?? buttons[index - 1]
    if (next)
      next.focus()
    else
      document.getElementById(filtersButtonId)?.focus()
  })
}

function revealChip(element: HTMLElement | null) {
  if (!phone.value || !element)
    return
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function revealActiveChip() {
  revealChip(viewRow.value?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? null)
}

function onViewFocus(event: FocusEvent) {
  const target = event.target
  if (target instanceof HTMLElement)
    revealChip(target.closest('button'))
}

function onExportClosed() {
  if (!phone.value)
    return
  document.getElementById(toolsButtonId)?.focus()
}

function onHistory() {
  sheetOpen.value = false
}

function findScroller(): HTMLElement | null {
  const start = document.getElementById('transfer-day-list')
  let scroller = start?.parentElement ?? null
  while (scroller) {
    const overflow = getComputedStyle(scroller).overflowY
    if (overflow === 'auto' || overflow === 'scroll')
      return scroller
    scroller = scroller.parentElement
  }
  return null
}

function unbindScroller() {
  scrollTarget?.removeEventListener('scroll', placeStickySearch)
  scrollTarget = null
}

function placeStickySearch() {
  if (!window.matchMedia('(max-width: 1023px)').matches) {
    stickyStyle.value = {}
    unbindScroller()
    return
  }
  const scroller = findScroller()
  const anchor = searchAnchor.value
  if (!scroller || !anchor) {
    stickyStyle.value = {}
    unbindScroller()
    return
  }
  if (scrollTarget !== scroller) {
    unbindScroller()
    scroller.addEventListener('scroll', placeStickySearch, { passive: true })
    scrollTarget = scroller
  }
  const scrollerBox = scroller.getBoundingClientRect()
  const anchorBox = anchor.getBoundingClientRect()
  // In flow until the row meets the panel. Pinning earlier covers the day.
  if (anchorBox.top > scrollerBox.top + 1) {
    if (stickyStyle.value.top)
      stickyStyle.value = {}
    return
  }
  const pad = getComputedStyle(scroller)
  const next = {
    top: `${scrollerBox.top}px`,
    left: `${scrollerBox.left}px`,
    width: `${scrollerBox.width}px`,
    paddingLeft: pad.paddingLeft,
    paddingRight: pad.paddingRight,
  }
  if (stickyStyle.value.top === next.top && stickyStyle.value.left === next.left && stickyStyle.value.width === next.width)
    return
  stickyStyle.value = next
}

onMounted(() => {
  const query = window.matchMedia('(max-width: 1023px)')
  const apply = () => {
    phone.value = query.matches
    if (!phone.value)
      sheetOpen.value = false
    placeStickySearch()
    void nextTick(revealActiveChip)
  }
  apply()
  window.addEventListener('resize', placeStickySearch)
  // Read after mount, like the occupation strip. A collapsed choice may
  // shift the desktop layout once. Filters in the address do not open it.
  if (readTransferDayFiltersCollapsed(localStorage, storageKey()))
    filtersOpen.value = false
  query.addEventListener('change', apply)
  window.addEventListener('popstate', onHistory)
  onScopeDispose(() => {
    query.removeEventListener('change', apply)
    window.removeEventListener('resize', placeStickySearch)
    window.removeEventListener('popstate', onHistory)
    unbindScroller()
  })
})

watch(filter, () => {
  void nextTick(revealActiveChip)
})
</script>

<template>
  <header class="mb-3 border-b border-default pb-3 print:hidden">
    <a
      href="#transfer-day-list"
      class="tp-safe-skip sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-default focus:px-3 focus:py-2 focus:text-default"
      @click.prevent="emit('focusList')"
    >
      {{ t('transfers.skipToRides') }}
    </a>

    <div class="mb-3 flex flex-wrap items-end gap-2">
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-chevron-left"
        :class="controlClass"
        :aria-label="t('transfers.previousDay')"
        @click="shift(-1)"
      />
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        :class="controlClass"
        @click="emit('today')"
      >
        {{ t('transfers.today') }}
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-chevron-right"
        :class="controlClass"
        :aria-label="t('transfers.nextDay')"
        @click="shift(1)"
      />
      <div class="min-w-40 max-w-full">
        <label
          class="mb-1 block text-sm"
          :for="dayFieldId"
        >{{ t('transfers.day') }}</label>
        <UInput
          :id="dayFieldId"
          v-model="day"
          name="day"
          type="date"
          size="sm"
          class="w-full text-base"
          :ui="{ base: 'max-lg:h-11' }"
        />
      </div>
      <div
        v-if="note.length > 0"
        class="flex flex-wrap items-center gap-1 pb-1 text-sm"
        role="group"
        :aria-label="t('transfers.unassignedAhead')"
      >
        <span>{{ t('transfers.filters.unassigned') }}:</span>
        <template
          v-for="(part, index) in note"
          :key="part.date"
        >
          <span
            v-if="index > 0"
            aria-hidden="true"
          >,</span>
          <UButton
            type="button"
            color="neutral"
            variant="link"
            size="sm"
            class="h-7 min-h-7 px-1 text-sm tabular-nums max-lg:h-11 max-lg:min-h-11 max-lg:text-base"
            @click="day = part.date"
          >
            {{ part.name }} {{ part.count }}
          </UButton>
        </template>
      </div>
    </div>

    <div
      class="mb-3"
      role="group"
      :aria-label="t('transfers.view')"
    >
      <p class="mb-1 hidden text-sm lg:block">
        {{ t('transfers.view') }}
      </p>
      <div
        ref="viewRow"
        class="flex gap-1 max-lg:flex-nowrap max-lg:overflow-x-auto lg:flex-wrap"
        @focusin="onViewFocus"
      >
        <UButton
          v-for="item in TRANSFER_DAY_FILTERS"
          :key="item"
          type="button"
          color="neutral"
          :variant="filter === item ? 'solid' : 'outline'"
          size="sm"
          class="shrink-0 whitespace-nowrap"
          :class="controlClass"
          :aria-pressed="filter === item"
          :aria-describedby="item === 'urgent' && showHiddenUrgent ? hiddenUrgentId : undefined"
          @click="filter = item"
        >
          {{ chipText(t(`transfers.filters.${item}`), counts[item]) }}
        </UButton>
        <UButton
          type="button"
          color="neutral"
          :variant="filter === 'toInvoice' ? 'solid' : 'outline'"
          size="sm"
          class="shrink-0 whitespace-nowrap"
          :class="controlClass"
          :aria-pressed="filter === 'toInvoice'"
          @click="filter = 'toInvoice'"
        >
          {{ chipText(t('transfers.filters.toInvoice'), toInvoiceCount) }}
        </UButton>
        <UButton
          v-if="extraView"
          type="button"
          color="neutral"
          variant="solid"
          size="sm"
          class="shrink-0 whitespace-nowrap"
          :class="controlClass"
          aria-pressed="true"
          @click="filter = extraView"
        >
          {{ chipText(extraName(extraView), shownCount) }}
        </UButton>
      </div>
      <p
        v-if="showHiddenUrgent"
        :id="hiddenUrgentId"
        class="mt-1 flex flex-wrap items-center gap-2 text-sm text-default tabular-nums"
      >
        <UIcon
          name="i-lucide-info"
          class="size-3.5 shrink-0"
          aria-hidden="true"
        />
        <span>{{ t('transfers.hiddenUrgent', { count: hiddenUrgent }) }}</span>
        <UButton
          type="button"
          color="neutral"
          variant="link"
          size="sm"
          class="h-7 min-h-7 px-1 text-sm max-lg:h-11 max-lg:min-h-11"
          @click="emit('clearAttributes')"
        >
          {{ t('transfers.clearFilters') }}
        </UButton>
      </p>
    </div>

    <div class="mb-3">
      <label
        class="mb-1 block text-sm"
        :for="searchFieldId"
      >{{ t('transfers.daySearch') }}</label>
      <!--
        The anchor stays in flow. On the phone the row pins to the panel
        only after that anchor reaches it, so the day controls stay
        uncovered. The label stays above the anchor. 44 px, an opaque
        surface, and a structural border so a scrolled Ride does not show
        through (WCAG 2.4.11).
      -->
      <div
        ref="searchAnchor"
        class="max-lg:h-11"
      >
        <div
          class="flex items-center gap-2 max-lg:z-30 max-lg:box-border max-lg:h-11 max-lg:border-b max-lg:border-default max-lg:bg-default"
          :class="{ 'max-lg:fixed': stickyStyle.top }"
          :style="stickyStyle"
        >
          <UInput
            :id="searchFieldId"
            v-model="search"
            name="search"
            type="search"
            icon="i-lucide-search"
            :placeholder="t('transfers.daySearchPlaceholder')"
            size="sm"
            class="min-w-0 flex-1 text-base"
            :ui="{ base: 'max-lg:h-11' }"
          />
          <UButton
            :id="filtersButtonId"
            type="button"
            color="neutral"
            variant="outline"
            size="sm"
            class="shrink-0"
            :class="controlClass"
            :aria-expanded="filtersExpanded"
            :aria-controls="filtersControls"
            @click="onFiltersClick"
          >
            {{ filtersButtonLabel }}
          </UButton>
        </div>
      </div>

      <div
        v-if="!phone"
        v-show="filtersOpen"
        id="transfer-day-filters"
        class="mt-2 max-lg:hidden"
      >
        <TransferDayFilterFields
          v-model:client-id="clientId"
          v-model:driver-id="driverId"
          v-model:vehicle-id="vehicleId"
          v-model:partner-id="partnerId"
          v-model:ride-state="rideState"
          v-model:needs-attention="needsAttention"
          :clients="clients"
          :drivers="drivers"
          :vehicles="vehicles"
          :partners="partners"
        />
      </div>

      <USlideover
        v-if="phone"
        :open="sheetOpen"
        side="bottom"
        modal
        :unmount-on-hide="false"
        :title="t('transfers.filterFields')"
        :content="{
          onOpenAutoFocus: onSheetOpenAutoFocus,
          onCloseAutoFocus: onSheetCloseAutoFocus,
        }"
        :ui="{
          content: 'max-h-[90vh] tp-safe-x',
          footer: 'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        }"
        @update:open="onSheetOpen"
        @after:leave="restoreSheetFocus"
      >
        <template #close>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            :aria-label="t('ride.detailClose')"
            @click="sheetOpen = false"
          />
        </template>
        <template #body>
          <div id="transfer-day-filter-sheet">
            <TransferDayFilterFields
              v-model:client-id="clientId"
              v-model:driver-id="driverId"
              v-model:vehicle-id="vehicleId"
              v-model:partner-id="partnerId"
              v-model:ride-state="rideState"
              v-model:needs-attention="needsAttention"
              :clients="clients"
              :drivers="drivers"
              :vehicles="vehicles"
              :partners="partners"
            />
          </div>
        </template>
        <template #footer>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              class="min-h-11"
              @click="emit('clearAttributes')"
            >
              {{ t('transfers.clearFilters') }}
            </UButton>
            <UButton
              type="button"
              class="min-h-11"
              @click="showRides"
            >
              {{ countsReady ? t('transfers.showRides', { count: shownCount }) : t('transfers.showRidesPending') }}
            </UButton>
          </div>
        </template>
      </USlideover>

      <div
        v-if="tags.length > 0"
        class="mt-2 flex flex-wrap items-center gap-2"
        role="group"
        :aria-label="t('transfers.activeFilters')"
      >
        <span
          v-for="(tag, index) in tags"
          :key="tag.key"
          class="inline-flex max-w-full items-center gap-1 rounded-md border border-default bg-default py-0.5 ps-2 text-sm text-default"
        >
          <span class="max-w-48 truncate">{{ tag.text }}</span>
          <button
            type="button"
            data-filter-remove
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-default hover:bg-elevated max-lg:size-11"
            :aria-label="t('transfers.removeFilter', { filter: tag.text })"
            @click="clearTag(tag.key, index)"
          >
            <UIcon
              name="i-lucide-x"
              class="size-4"
              aria-hidden="true"
            />
          </button>
        </span>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="sm"
          :class="controlClass"
          @click="emit('clearAttributes')"
        >
          {{ t('transfers.clearFilters') }}
        </UButton>
      </div>
    </div>

    <!--
      Last band. Osvježi, the time, and the switch stay one unit (ADR-0039),
      including on the phone, where that unit takes the row and Alati wraps
      under it. One switch, not a second copy beside the menu.
    -->
    <div class="flex flex-wrap items-center gap-3 max-lg:mb-3">
      <div class="flex flex-wrap items-center gap-3 max-lg:w-full">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="sm"
          :class="controlClass"
          @click="emit('refresh')"
        >
          {{ t('liveRefresh.refresh') }}
        </UButton>
        <p
          v-if="updatedLabel"
          class="text-sm text-muted tabular-nums"
        >
          {{ updatedLabel }}
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
      <div class="flex items-center gap-2 lg:ms-auto">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-printer"
          class="hidden h-7 min-h-7 lg:inline-flex"
          @click="emit('print')"
        >
          {{ t('transfers.printDay') }}
        </UButton>
        <RideCsvExport
          ref="exportDialog"
          :time-zone="timeZone"
          button-class="hidden h-7 min-h-7 lg:inline-flex"
          @closed="onExportClosed"
        />
        <div class="lg:hidden">
          <UDropdownMenu :items="toolItems">
            <UButton
              :id="toolsButtonId"
              type="button"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-wrench"
              class="min-h-11"
              :label="t('transfers.tools')"
            />
          </UDropdownMenu>
        </div>
      </div>
    </div>
  </header>
</template>
