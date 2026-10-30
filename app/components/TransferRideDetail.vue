<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Client, ClientOfficeBrief, DisplayLocale, Driver, LiveRefreshOutcome, OfficeLocation, Partner, PartnerOfficeContact, TransferDayRide, TransferGroupMember, Vehicle } from '../../shared'
import type { RideDetailCommand } from '../ride-detail'
import { canAddExtraVehicle, canRecordLandingTime, classifyRideAttention, formatInstant, locationLabel, officeCanCorrectTransfer, recordedSeatCount, rideDetailEmbedUrls, rideDetailMapOpen, transferAwaitingInvoice, transferGroupRole, transferGroupSchema } from '../../shared'
import { useKeptWorkOrders } from '../composables/kept-work-orders'
import { commandControlClass, commandControlSize, rideFormStamp } from '../ride-detail'
import { driverDisplayName } from '../transfer-day-labels'
import { canCallOff, canChangeAssignment, canChangePartner, canFinish, canHandOff, canNoShow, canRecordAcceptanceByPhone, canTakeBack } from '../transfer-ride-guards'
import { workOrderNotice } from '../work-order-notice'

const props = defineProps<{
  ride: TransferDayRide
  command: RideDetailCommand | null
  drivers: Driver[]
  vehicles: Vehicle[]
  partners: Partner[]
  declines: { driverName: string }[]
  timeZone: string
  locale: DisplayLocale
  nowMs: number
  dayRides: TransferDayRide[]
  /** Phone uses the driver list. Desktop uses the selects. */
  listDrivers: boolean
  /** Phone keeps the action bar on screen while the body scrolls. */
  pinActions: boolean
  loadDay: () => Promise<LiveRefreshOutcome>
  /** This Tenant's live contact persons and Client notes. The block uses the Ride's Client. */
  clientBriefs: ClientOfficeBrief[]
  /**
   * Phone and email of each Partner a Ride on this day is still handed to.
   * The Driver's read does not carry this list, so those links stay off the Driver's phone (ADR-0049).
   */
  partnerBriefs: PartnerOfficeContact[]
  operationalDayStartHour: number
  tenantId: string
  userId: string
  /** Storniraj and Povuci. A Dispatcher issues and retries, and does not see these. */
  isAdmin: boolean
  /**
   * The correction notice set this. Scroll the group list into view once
   * it has loaded. A full page load uses the `#transfer-group` hash instead.
   */
  revealGroup?: boolean
}>()

const emit = defineEmits<{
  command: [command: RideDetailCommand | null]
  close: []
  back: []
  done: []
  noShow: []
  cancelRide: []
  clear: []
  takeBack: []
  duplicate: []
  returnJourney: []
  extraVehicle: []
  saved: []
  groupRevealed: []
}>()
const day = defineModel<string>('day', { required: true })
const saved = defineModel<boolean>('saved', { required: true })
const corrected = defineModel<boolean>('corrected', { required: true })
const locations = defineModel<OfficeLocation[]>('locations', { required: true })
const startMapOpen = ref(false)
const endMapOpen = ref(false)
const clients = defineModel<Client[]>('clients', { required: true })

const { t } = useI18n()
const route = useRoute()
const { dismiss, kept } = useKeptWorkOrders()
const titleId = useId()
const snapshot = ref<TransferDayRide | null>(null)
const rideChanged = ref(false)
const staleNotice = ref(false)
const refreshing = ref(false)
const correctForm = ref<{
  formMode: 'add' | 'edit' | null
  openCorrect: (ride: TransferDayRide) => void
} | null>(null)

watch(() => correctForm.value?.formMode, (mode, previous) => {
  // Cancel closes the form. Facts and the commands come back. A save sets
  // corrected and the day closes the detail on its own.
  if (props.command === 'correct' && previous === 'edit' && mode !== 'edit' && !corrected.value)
    emit('command', null)
})

watch(() => props.command, (command) => {
  if (command) {
    snapshot.value = props.ride
    rideChanged.value = false
    staleNotice.value = false
    return
  }
  snapshot.value = null
  rideChanged.value = false
  staleNotice.value = false
}, { immediate: true })

watch(() => props.ride, (ride) => {
  if (!props.command || !snapshot.value)
    return
  if (rideFormStamp(ride) !== rideFormStamp(snapshot.value))
    rideChanged.value = true
})

const formRide = computed(() => (props.command && snapshot.value ? snapshot.value : props.ride))

/** The opened version is still on screen. The notice must not name that author. */
const staleAuthorHidden = computed(() =>
  snapshot.value !== null && props.ride.version === snapshot.value.version,
)

/** Assign stays on an unassigned Ride. The other assignment commands use canChangeAssignment. */
function openedCommandStillAllowed(ride: TransferDayRide): boolean {
  if (props.command === 'assign')
    return ride.state === 'unassigned'
  if (props.command === 'handOff')
    return canHandOff(ride)
  if (props.command === 'changePartner')
    return canChangePartner(ride)
  if (props.command === 'reassign' || props.command === 'vehicle')
    return canChangeAssignment(ride)
  if (props.command === 'correct')
    return officeCanCorrectTransfer(ride.state)
  return true
}

async function noteStale() {
  // The 409 carries no name. The day read does. The snapshot stays, so the
  // typed values and the opened version stay until Osvježi.
  const outcome = await props.loadDay()
  if (outcome !== 'fail')
    await nextTick()
  staleNotice.value = true
}

async function refreshStale() {
  if (refreshing.value)
    return
  refreshing.value = true
  try {
    const outcome = await props.loadDay()
    // A failed read keeps the last rows. A superseded one may not have
    // applied its body yet. Either way the form stays on the opened version.
    if (outcome === 'fail')
      return
    await nextTick()
    if (outcome === 'stale' && snapshot.value && rideFormStamp(props.ride) === rideFormStamp(snapshot.value))
      return
    snapshot.value = props.ride
    rideChanged.value = false
    staleNotice.value = false
    const ride = props.ride
    if (props.command === 'correct' && officeCanCorrectTransfer(ride.state))
      correctForm.value?.openCorrect(ride)
    if (!openedCommandStillAllowed(ride))
      emit('command', null)
  }
  finally {
    refreshing.value = false
  }
}

const notices = computed(() => kept.value.filter(entry =>
  entry.rideId === props.ride.rideId || entry.rideId === props.ride.transferId,
))

const attention = computed(() => classifyRideAttention(
  { ...props.ride, seatCount: recordedSeatCount(props.vehicles, props.ride.vehicleId) },
  props.declines,
  props.nowMs,
))

/** The Ride's Client. A missing brief is a Client the day read did not return. */
const officeBrief = computed(() =>
  props.clientBriefs.find(brief => brief.clientId === props.ride.clientId) ?? null,
)

/**
 * Phone and email while this Ride is still handed off. A closed Ride no
 * longer names the Partner, so the links leave with that state. A missing
 * brief, or a blank phone or email, simply has no link.
 */
const partnerContact = computed(() => {
  if (props.ride.state !== 'handed_off' || props.ride.partnerId === null)
    return null
  return props.partnerBriefs.find(brief => brief.partnerId === props.ride.partnerId) ?? null
})

const startLocation = computed(() =>
  locations.value.find(location => location.id === props.ride.startLocationId) ?? null,
)
const endLocation = computed(() =>
  locations.value.find(location => location.id === props.ride.endLocationId) ?? null,
)

function placeLabel(location: OfficeLocation | null): string {
  return location ? locationLabel(location) : t('transfers.unknownPlace')
}

/**
 * The start and the end, each only when that Location has an Embed URL.
 * The same Location keeps the end quiet (ADR-0052).
 */
const mapUrls = computed(() => rideDetailEmbedUrls({
  startLocationId: props.ride.startLocationId,
  endLocationId: props.ride.endLocationId,
  startEmbedUrl: startLocation.value?.embedUrl ?? null,
  endEmbedUrl: endLocation.value?.embedUrl ?? null,
}))

function applyMaps(press: { slot: 'start' | 'end', open: boolean } | null, rideChanged: boolean) {
  const next = rideDetailMapOpen(
    { start: startMapOpen.value, end: endMapOpen.value },
    {
      rideChanged,
      startUrl: mapUrls.value.start,
      endUrl: mapUrls.value.end,
      // pinActions is the phone layout. Opening one map then closes the other.
      phone: props.pinActions,
      press,
    },
  )
  startMapOpen.value = next.start
  endMapOpen.value = next.end
}

function pressMap(slot: 'start' | 'end', open: boolean) {
  applyMaps({ slot, open }, false)
}

// A refresh that keeps the URL leaves the open flags alone, so the frame
// stays mounted. A new Ride, or a URL that is gone, closes that map.
watch(
  () => [props.ride.rideId, mapUrls.value.start, mapUrls.value.end] as const,
  (next, previous) => {
    applyMaps(null, previous !== undefined && next[0] !== previous[0])
  },
)

function partnerLabel(id: string | null): string {
  if (id === null)
    return t('ride.unknownPartner')
  const partner = props.partners.find(item => item.id === id)
  if (!partner)
    return t('ride.unknownPartner')
  return partner.archivedAt === null ? partner.name : `${partner.name} · ${t('partners.archived')}`
}

function plate(id: string | null): string {
  if (id === null)
    return ''
  return props.vehicles.find(vehicle => vehicle.id === id)?.registrationPlate ?? ''
}

const invoiceError = ref<string | null>(null)
const invoiceClientId = ref<string | null>(null)
const invoicePending = ref(false)

const showInvoice = computed(() => props.ride.invoice !== null || transferAwaitingInvoice(props.ride))

function readInvoiceError(error: unknown): { code: string | null, clientId: string | null } {
  if (typeof error !== 'object' || error === null || !('data' in error))
    return { code: null, clientId: null }
  const data = error.data
  if (typeof data !== 'object' || data === null || !('code' in data) || typeof data.code !== 'string')
    return { code: null, clientId: null }
  const clientId = 'clientId' in data && typeof data.clientId === 'string' ? data.clientId : null
  return { code: data.code, clientId }
}

/**
 * Issue or retry, then reload the day until the job has stored a result.
 * The response itself is only the requested row. The number arrives with
 * the job, which can wait out this tenant's ten-second spacing.
 */
async function postInvoice(path: string) {
  if (invoicePending.value)
    return
  invoicePending.value = true
  invoiceError.value = null
  invoiceClientId.value = null
  try {
    await $fetch(path, { method: 'POST', body: {} })
    // The number is written by the job, which waits out this tenant's
    // ten-second spacing and can sit in the queue. Keep the day current
    // until that row leaves "requested". A new issue must not stop on the
    // cancelled invoice still on screen.
    const issuing = path.endsWith('/invoice') || path.endsWith('/retry')
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const outcome = await props.loadDay()
      // The day ref updates in the parent. Wait for that render, or this
      // still reads the previous invoice.
      await nextTick()
      const state = props.ride.invoice?.state
      const previous = state === 'cancelled' || state === 'withdrawn' || state === undefined
      if (outcome === 'ok' && state !== 'requested' && state !== 'cancelling' && !(issuing && previous))
        return
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  catch (error) {
    const read = readInvoiceError(error)
    invoiceError.value = read.code
    invoiceClientId.value = read.clientId
  }
  finally {
    invoicePending.value = false
  }
}

function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}

function clock(instant: string): string {
  return formatInstant(new Date(instant), props.timeZone, props.locale)
}

const primary = computed<'assign' | 'accept' | 'done' | null>(() => {
  if (props.ride.state === 'unassigned')
    return 'assign'
  if (canRecordAcceptanceByPhone(props.ride))
    return 'accept'
  if (canFinish(props.ride))
    return 'done'
  return null
})

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const ride = props.ride
  const items: DropdownMenuItem[] = []
  if (officeCanCorrectTransfer(ride.state))
    items.push({ label: t('transfers.correct'), icon: 'i-lucide-pencil', onSelect: () => emit('command', 'correct') })
  if (canRecordLandingTime(ride.state))
    items.push({ label: t('ride.recordLanding'), icon: 'i-lucide-plane-landing', onSelect: () => emit('command', 'landing') })
  if (canCallOff(ride))
    items.push({ label: t('ride.cancelRide'), icon: 'i-lucide-ban', onSelect: () => emit('cancelRide') })
  if (canNoShow(ride))
    items.push({ label: t('ride.markNoShow'), icon: 'i-lucide-user-x', onSelect: () => emit('noShow') })
  if (canChangeAssignment(ride)) {
    items.push({ label: t('ride.changeVehicle'), icon: 'i-lucide-car', onSelect: () => emit('command', 'vehicle') })
    items.push({ label: t('ride.reassign'), icon: 'i-lucide-arrow-left-right', onSelect: () => emit('command', 'reassign') })
    items.push({ label: t('ride.clear'), icon: 'i-lucide-user-minus', onSelect: () => emit('clear') })
  }
  // ADR-0038: the detail bar is one primary action and Više. These commands
  // live in that menu, beside take-back.
  if (canHandOff(ride))
    items.push({ label: t('ride.handOff'), icon: 'i-lucide-handshake', onSelect: () => emit('command', 'handOff') })
  if (canChangePartner(ride))
    items.push({ label: t('ride.changePartner'), icon: 'i-lucide-handshake', onSelect: () => emit('command', 'changePartner') })
  if (canTakeBack(ride))
    items.push({ label: t('ride.takeBack'), icon: 'i-lucide-corner-up-left', onSelect: () => emit('takeBack') })
  if (primary.value === null && canFinish(ride))
    items.push({ label: t('ride.markDone'), onSelect: () => emit('done') })
  // Adds a linked Transfer. On an extra vehicle this names its main Transfer.
  if (canAddExtraVehicle(ride))
    items.push({ label: t('transfers.extraVehicle'), icon: 'i-lucide-car-front', onSelect: () => emit('extraVehicle') })
  // Both only open a new form. They stay available after the Ride is closed.
  // An extra vehicle does not offer them: a Price of 0 must keep its link.
  if (ride.mainTransferId === null) {
    items.push({ label: t('transfers.duplicate'), icon: 'i-lucide-copy', onSelect: () => emit('duplicate') })
    items.push({ label: t('transfers.returnJourney'), icon: 'i-lucide-undo-2', onSelect: () => emit('returnJourney') })
  }
  return [items]
})

function runPrimary() {
  if (primary.value === 'assign')
    emit('command', 'assign')
  else if (primary.value === 'accept')
    emit('command', 'accept')
  else if (primary.value === 'done')
    emit('done')
}

const groupMembers = ref<TransferGroupMember[] | null>(null)
const groupError = ref(false)
const groupSection = ref<HTMLElement | null>(null)
let groupRequest = 0
let groupRevealed = false

/**
 * Members can pick up on another day, so the day list is not the group.
 * Each row below uses that member's own pickup. The ordered count is the
 * main Transfer's, read from that member, not copied onto the others.
 */
function loadGroup() {
  if (!import.meta.client)
    return
  const ride = props.ride
  const role = transferGroupRole(
    ride.mainTransferId,
    ride.groupPassengerCountStored ? ride.groupPassengerCount : null,
  )
  const token = ++groupRequest
  if (role === null) {
    groupMembers.value = null
    groupError.value = false
    return
  }
  groupError.value = false
  void $fetch(`/api/transfers/${ride.transferId}/group`)
    .then((body) => {
      if (token !== groupRequest)
        return
      const members = transferGroupSchema.parse(body).members
      groupMembers.value = members.length > 0 ? members : null
    })
    .catch(() => {
      if (token !== groupRequest)
        return
      groupMembers.value = null
      groupError.value = true
    })
}

watch(
  () => [props.ride.transferId, props.ride.version, props.ride.mainTransferId, props.ride.groupPassengerCount, props.ride.groupPassengerCountStored] as const,
  () => {
    loadGroup()
  },
  { immediate: true },
)

watch(() => props.ride.rideId, () => {
  groupRevealed = false
})

/**
 * The notice and a `#transfer-group` load both land on this list. Wait
 * until the members (or the load error) are on screen, then scroll once.
 */
watch(
  [groupMembers, groupError, () => props.revealGroup, () => route.hash],
  () => {
    const asked = props.revealGroup === true || route.hash === '#transfer-group'
    if (!asked || groupRevealed)
      return
    if (groupMembers.value === null && !groupError.value)
      return
    groupRevealed = true
    void nextTick(() => {
      const section = groupSection.value
      if (!section)
        return
      section.scrollIntoView({ block: 'start' })
      section.focus()
      if (props.revealGroup)
        emit('groupRevealed')
    })
  },
)

const groupOrderedCount = computed(() =>
  groupMembers.value?.find(member => member.mainTransferId === null)?.groupPassengerCount ?? null,
)

function memberPlace(id: string): string {
  const found = locations.value.find(location => location.id === id)
  return found ? locationLabel(found) : t('transfers.unknownPlace')
}

function memberCrew(member: TransferGroupMember): string {
  if (member.state === 'handed_off')
    return partnerLabel(member.partnerId)
  if (member.driverId === null)
    return t('transfers.unassignedCrew')
  return driverDisplayName(props.drivers, member.driverId, t('ride.unknownDriver'))
}

const primaryLabel = computed(() => {
  if (primary.value === 'assign')
    return t('ride.assign')
  if (primary.value === 'accept')
    return t('transfers.rowAccept')
  if (primary.value === 'done')
    return t('transfers.rowDone')
  return ''
})
</script>

<template>
  <article
    id="ride-detail"
    :aria-labelledby="titleId"
    tabindex="-1"
    class="outline-none"
    :class="pinActions ? 'flex min-h-full flex-col' : undefined"
  >
    <header class="mb-4 flex items-start justify-between gap-2">
      <h2
        :id="titleId"
        class="text-lg font-semibold"
      >
        {{ ride.guestName }}
      </h2>
      <div class="flex gap-1">
        <UButton
          v-if="pinActions"
          type="button"
          color="neutral"
          variant="ghost"
          size="xl"
          icon="i-lucide-arrow-left"
          class="min-h-11"
          :label="t('ride.detailBack')"
          @click="emit('back')"
        />
        <UButton
          v-else
          type="button"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-x"
          :aria-label="t('ride.detailClose')"
          @click="emit('close')"
        />
      </div>
    </header>

    <UAlert
      v-if="rideChanged"
      color="warning"
      variant="subtle"
      class="mb-4"
      :description="t('ride.changed')"
      :ui="{ title: '!text-default !opacity-100', description: '!text-default !opacity-100' }"
    />

    <StaleSaveAlert
      v-if="staleNotice"
      :changed-by-name="staleAuthorHidden ? null : ride.changedByName"
      :changed-at="staleAuthorHidden ? null : ride.changedAt"
      :time-zone="timeZone"
      :locale="locale"
      :phone="pinActions"
      :pending="refreshing"
      @refresh="refreshStale"
    />

    <UAlert
      v-for="notice in notices"
      :key="notice.id"
      :color="workOrderNotice(notice.outcome).color"
      variant="subtle"
      class="mb-3"
      role="alert"
      :title="notice.actionTitle"
      :close="true"
      :description="t(workOrderNotice(notice.outcome).key, { name: notice.driverName })"
      :ui="{ title: '!text-default !opacity-100', description: '!text-default !opacity-100' }"
      @update:open="(open: boolean) => { if (!open) dismiss(notice.id) }"
    />

    <RideMarks
      v-if="attention.length > 0"
      class="mb-4"
      :items="attention"
      full
    />

    <UCollapsible
      v-if="officeBrief"
      id="ride-client-office"
      class="mb-4"
    >
      <template #default="{ open }">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="commandControlSize(pinActions)"
          class="w-full justify-between"
          :class="commandControlClass(pinActions)"
          :label="t('ride.clientOffice')"
          :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        />
      </template>
      <template #content>
        <ul
          v-if="officeBrief.contactPersons.length > 0"
          class="mt-3 space-y-3"
        >
          <li
            v-for="person in officeBrief.contactPersons"
            :key="person.id"
          >
            <p class="font-medium text-default">
              {{ person.name }}
            </p>
            <p
              v-if="person.role"
              class="text-muted"
            >
              {{ person.role }}
            </p>
            <p v-if="person.phone">
              <a
                class="text-primary underline"
                :href="`tel:${person.phone}`"
              >{{ person.phone }}</a>
            </p>
            <p v-if="person.email">
              <a
                class="text-primary underline"
                :href="`mailto:${person.email}`"
              >{{ person.email }}</a>
            </p>
          </li>
        </ul>
        <p
          v-else
          class="mt-3 text-muted"
        >
          {{ t('clients.contacts.empty') }}
        </p>
        <p class="mt-3 whitespace-pre-wrap text-default">
          <span class="font-medium">{{ t('transfers.clientNote') }}</span>
          {{ ' ' }}
          {{ officeBrief.note ?? t('ride.clientOfficeNoNote') }}
        </p>
      </template>
    </UCollapsible>

    <!--
      Hidden, not removed, while a command is open. An open map stays
      mounted, so cancel does not load it again (ADR-0052).
    -->
    <dl
      v-show="!command"
      class="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"
      :aria-label="t('ride.detailFacts')"
    >
      <dt>{{ t('transfers.fields.pickupAt') }}</dt>
      <dd>
        <time
          class="tabular-nums"
          :datetime="ride.pickupAt"
        >{{ clock(ride.pickupAt) }}</time>
      </dd>
      <template v-if="ride.flightNumber">
        <dt>{{ t('transfers.fields.flightNumber') }}</dt>
        <dd class="font-mono">
          {{ ride.flightNumber }}
        </dd>
      </template>
      <template v-if="ride.landingAt">
        <dt>{{ t('transfers.fields.landingAt') }}</dt>
        <dd>
          <time
            class="tabular-nums"
            :datetime="ride.landingAt"
          >{{ clock(ride.landingAt) }}</time>
        </dd>
      </template>
      <template v-else-if="ride.expectedArrival">
        <dt>{{ t('transfers.fields.expectedArrival') }}</dt>
        <dd>
          <time
            class="tabular-nums"
            :datetime="ride.expectedArrival"
          >{{ clock(ride.expectedArrival) }}</time>
        </dd>
      </template>
      <dt>{{ t('transfers.fields.passengerCount') }}</dt>
      <dd class="tabular-nums">
        {{ ride.passengerCount }}
      </dd>
      <dt>{{ t('transfers.start') }}</dt>
      <dd>{{ placeLabel(startLocation) }}</dd>
      <!-- The map spans the panel. The name stays in the column beside the label. -->
      <dd
        v-if="mapUrls.start"
        class="col-span-2"
      >
        <LocationMapToggle
          :open="startMapOpen"
          :embed-url="mapUrls.start"
          :name="startLocation?.name ?? ''"
          :phone="pinActions"
          @update:open="pressMap('start', $event)"
        />
      </dd>
      <dt>{{ t('transfers.end') }}</dt>
      <dd>{{ placeLabel(endLocation) }}</dd>
      <dd
        v-if="mapUrls.end"
        class="col-span-2"
      >
        <LocationMapToggle
          :open="endMapOpen"
          :embed-url="mapUrls.end"
          :name="endLocation?.name ?? ''"
          :phone="pinActions"
          @update:open="pressMap('end', $event)"
        />
      </dd>
      <dt>{{ t('transfers.columns.client') }}</dt>
      <dd>{{ clients.find(client => client.id === ride.clientId)?.name ?? '' }}</dd>
      <!-- A handed-off Ride has no Driver and no Vehicle. "Nedodijeljeno" is
           the unassigned state, and ADR-0048 says this Ride is not that. -->
      <template v-if="ride.state !== 'handed_off'">
        <dt>{{ t('ride.driver') }}</dt>
        <dd>{{ driverDisplayName(drivers, ride.driverId, t('ride.unknownDriver')) || t('transfers.unassignedCrew') }}</dd>
        <dt>{{ t('ride.vehicle') }}</dt>
        <dd class="font-mono">
          {{ plate(ride.vehicleId) || t('transfers.unassignedCrew') }}
        </dd>
      </template>
      <template v-if="ride.state === 'handed_off'">
        <dt>{{ t('ride.partner') }}</dt>
        <dd id="ride-partner-contact">
          <span class="block">{{ partnerLabel(ride.partnerId) }}</span>
          <!-- 28 px in the office, 48 px on the phone. A smaller link fails the 24 px target-size check. -->
          <a
            v-if="partnerContact?.phone"
            class="mt-1 flex items-center text-primary underline"
            :class="commandControlClass(pinActions)"
            :href="`tel:${partnerContact.phone}`"
          >{{ partnerContact.phone }}</a>
          <a
            v-if="partnerContact?.email"
            class="mt-1 flex items-center text-primary underline"
            :class="commandControlClass(pinActions)"
            :href="`mailto:${partnerContact.email}`"
          >{{ partnerContact.email }}</a>
        </dd>
      </template>
      <dt>{{ t('transfers.status') }}</dt>
      <dd>{{ t(`transfers.states.${ride.state}`) }}</dd>
      <dt>{{ t('transfers.fields.price') }}</dt>
      <dd class="tabular-nums">
        {{ priceLabel(ride.price) }} · {{ t(`transfers.payments.${ride.payment}`) }}
      </dd>
      <template v-if="showInvoice">
        <dt>{{ t('transfers.invoice.title') }}</dt>
        <dd id="transfer-invoice">
          <p v-if="ride.invoice">
            {{ t(`transfers.invoice.states.${ride.invoice.state}`) }}
            <span v-if="ride.invoice.number">{{ ride.invoice.number }}</span>
            <span v-if="ride.invoice.stornoNumber">{{ ride.invoice.stornoNumber }}</span>
            <span v-if="ride.invoice.reason">{{ t(`transfers.invoice.reasons.${ride.invoice.reason}`) }}</span>
          </p>
          <!-- 28px tall, on its own row, so two links still meet the 24px target. -->
          <a
            v-if="ride.invoice?.documentLink"
            class="mt-1 flex min-h-7 w-fit items-center text-primary underline"
            :href="ride.invoice.documentLink"
            target="_blank"
            rel="noopener noreferrer"
          >{{ t('transfers.invoice.open') }}</a>
          <a
            v-if="ride.invoice?.stornoLink"
            class="mt-1 flex min-h-7 w-fit items-center text-primary underline"
            :href="ride.invoice.stornoLink"
            target="_blank"
            rel="noopener noreferrer"
          >{{ t('transfers.invoice.openStorno') }}</a>
          <UButton
            v-if="isAdmin && (ride.invoice?.state === 'created' || ride.invoice?.state === 'sent')"
            type="button"
            size="sm"
            :loading="invoicePending"
            @click="postInvoice(`/api/transfers/${ride.transferId}/invoice/storno`)"
          >
            {{ t('transfers.invoice.storno') }}
          </UButton>
          <UButton
            v-if="isAdmin && ride.invoice?.state === 'failed'"
            type="button"
            size="sm"
            :loading="invoicePending"
            @click="postInvoice(`/api/transfers/${ride.transferId}/invoice/withdraw`)"
          >
            {{ t('transfers.invoice.withdraw') }}
          </UButton>
          <UButton
            v-if="transferAwaitingInvoice(ride)"
            type="button"
            size="sm"
            :loading="invoicePending"
            @click="postInvoice(`/api/transfers/${ride.transferId}/invoice`)"
          >
            {{ t('transfers.invoice.issue') }}
          </UButton>
          <UButton
            v-if="ride.invoice?.state === 'failed'"
            type="button"
            size="sm"
            :loading="invoicePending"
            @click="postInvoice(`/api/transfers/${ride.transferId}/invoice/retry`)"
          >
            {{ t('transfers.invoice.retry') }}
          </UButton>
          <p v-if="invoiceError">
            {{ t(`transfers.invoice.errors.${invoiceError}`) }}
          </p>
          <NuxtLink
            v-if="invoiceError === 'billing_details_missing'"
            class="text-primary underline"
            :to="invoiceClientId ? `/clients?client=${invoiceClientId}` : '/clients'"
            :data-client-id="invoiceClientId ?? undefined"
          >
            {{ t('transfers.invoice.billingLink') }}
          </NuxtLink>
        </dd>
      </template>
      <template v-if="ride.tabla">
        <dt>{{ t('transfers.fields.tabla') }}</dt>
        <dd>{{ ride.tabla }}</dd>
      </template>
      <template v-if="ride.note">
        <dt>{{ t('transfers.fields.note') }}</dt>
        <dd>{{ ride.note }}</dd>
      </template>
      <template v-if="ride.luggageCount > 0">
        <dt>{{ t('transfers.fields.luggageCount') }}</dt>
        <dd class="tabular-nums">
          {{ ride.luggageCount }}
        </dd>
      </template>
      <template v-if="ride.childSeatCount > 0">
        <dt>{{ t('transfers.fields.childSeatCount') }}</dt>
        <dd class="tabular-nums">
          {{ ride.childSeatCount }}
        </dd>
      </template>
    </dl>

    <section
      v-if="groupError || (groupMembers && groupMembers.length > 0)"
      v-show="!command"
      id="transfer-group"
      ref="groupSection"
      tabindex="-1"
      class="mb-4 text-sm outline-none"
      :aria-label="t('transfers.group')"
    >
      <h3 class="font-medium">
        {{ t('transfers.group') }}
      </h3>
      <p
        v-if="groupError"
        class="mt-2"
        role="alert"
      >
        {{ t('transfers.groupLoadFailed') }}
      </p>
      <template v-else-if="groupMembers">
        <p
          v-if="groupOrderedCount !== null"
          class="mt-2 tabular-nums"
        >
          {{ t('transfers.groupPassengers') }}: {{ groupOrderedCount }}
        </p>
        <ul class="mt-2 flex flex-col gap-2">
          <li
            v-for="member in groupMembers"
            :key="member.rideId"
          >
            <span class="font-medium">{{ member.guestName }}</span>
            <time
              class="ms-2 tabular-nums"
              :datetime="member.pickupAt"
            >{{ clock(member.pickupAt) }}</time>
            <span class="mt-0.5 block">{{ memberPlace(member.startLocationId) }} → {{ memberPlace(member.endLocationId) }}</span>
            <span class="block text-muted">{{ memberCrew(member) }} · {{ t(`transfers.states.${member.state}`) }}</span>
          </li>
        </ul>
      </template>
    </section>

    <RideAssign
      v-if="command === 'assign'"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
      :passenger-count="formRide.passengerCount"
      :drivers="drivers"
      :vehicles="vehicles"
      :list-drivers="listDrivers"
      :phone="pinActions"
      :day-rides="dayRides"
      :pickup-at="formRide.pickupAt"
      :landing-at="formRide.landingAt"
      :version="formRide.version"
      :ride-driver-id="formRide.driverId"
      :ride-vehicle-id="formRide.vehicleId"
      :on-stale="noteStale"
      @assigned="emit('saved')"
      @cancel="emit('command', null)"
    />
    <RideVehicle
      v-else-if="command === 'vehicle' && formRide.vehicleId"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
      :passenger-count="formRide.passengerCount"
      :vehicle-id="formRide.vehicleId"
      :version="formRide.version"
      :drivers="drivers"
      :vehicles="vehicles"
      :phone="pinActions"
      :on-stale="noteStale"
      @saved="emit('saved')"
      @cancel="emit('command', null)"
    />
    <RideReassign
      v-else-if="command === 'reassign' && formRide.driverId"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
      :passenger-count="formRide.passengerCount"
      :driver-id="formRide.driverId"
      :version="formRide.version"
      :drivers="drivers"
      :vehicles="vehicles"
      :phone="pinActions"
      :on-stale="noteStale"
      @saved="emit('saved')"
      @cancel="emit('command', null)"
    />
    <RideLanding
      v-else-if="command === 'landing'"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
      :landing-at="formRide.landingAt"
      :time-zone="timeZone"
      :phone="pinActions"
      @saved="emit('saved')"
      @cancel="emit('command', null)"
    />
    <RideHandOff
      v-else-if="command === 'handOff' || command === 'changePartner'"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
      :partners="partners"
      :drivers="drivers"
      :current-partner-id="formRide.partnerId"
      :clears-crew="formRide.driverId !== null || formRide.vehicleId !== null"
      :mode="command === 'changePartner' ? 'changePartner' : 'handOff'"
      :version="formRide.version"
      :phone="pinActions"
      :on-stale="noteStale"
      @saved="emit('saved')"
      @cancel="emit('command', null)"
    />
    <RideAcceptByPhoneDialog
      v-else-if="command === 'accept'"
      :ride="formRide"
      :load-day="async () => { await loadDay() }"
      :phone="pinActions"
      @done="emit('saved')"
      @cancel="emit('command', null)"
    />
    <!-- The correction form is a child here, so it lands in this panel. -->
    <TransferForm
      v-else-if="command === 'correct'"
      ref="correctForm"
      v-model:day="day"
      v-model:saved="saved"
      v-model:corrected="corrected"
      v-model:locations="locations"
      v-model:clients="clients"
      :client-briefs="clientBriefs"
      in-panel
      :phone="pinActions"
      :correct-ride="formRide"
      :time-zone="timeZone"
      :locale="locale"
      :operational-day-start-hour="operationalDayStartHour"
      :tenant-id="tenantId"
      :user-id="userId"
      :drivers="drivers"
      :load-day="async () => { await loadDay() }"
      :on-stale="noteStale"
    />

    <div
      v-if="!command"
      class="flex flex-wrap items-center gap-2 bg-default"
      :class="pinActions ? 'sticky bottom-0 z-10 mt-auto -mx-1 border-t border-default px-1 py-3' : 'mt-4'"
    >
      <UButton
        v-if="primary"
        type="button"
        :size="pinActions ? 'xl' : 'sm'"
        :class="pinActions ? 'min-h-12 flex-1 justify-center' : 'h-7 min-h-7 flex-1 justify-center'"
        @click="runPrimary"
      >
        {{ primaryLabel }}
      </UButton>
      <UDropdownMenu
        v-if="menuItems.length > 0"
        :items="menuItems"
      >
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="pinActions ? 'xl' : 'sm'"
          icon="i-lucide-ellipsis"
          :class="pinActions ? 'min-h-12' : 'h-7 min-h-7'"
          :label="t('ride.detailMore')"
        />
      </UDropdownMenu>
    </div>
  </article>
</template>
