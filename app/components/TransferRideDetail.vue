<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Client, ClientOfficeBrief, DisplayLocale, Driver, LiveRefreshOutcome, Location, Partner, TransferDayRide, Vehicle } from '../../shared'
import type { RideDetailCommand } from '../ride-detail'
import { canCorrectTransfer, canRecordLandingTime, classifyRideAttention, formatInstant, locationLabel } from '../../shared'
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
  operationalDayStartHour: number
  tenantId: string
  userId: string
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
  saved: []
}>()
const day = defineModel<string>('day', { required: true })
const saved = defineModel<boolean>('saved', { required: true })
const corrected = defineModel<boolean>('corrected', { required: true })
const locations = defineModel<Location[]>('locations', { required: true })
const clients = defineModel<Client[]>('clients', { required: true })

const { t } = useI18n()
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
    return canCorrectTransfer(ride.state)
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
    if (props.command === 'correct' && canCorrectTransfer(ride.state))
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

const attention = computed(() => classifyRideAttention(props.ride, props.declines, props.nowMs))

/** The Ride's Client. A missing brief is a Client the day read did not return. */
const officeBrief = computed(() =>
  props.clientBriefs.find(brief => brief.clientId === props.ride.clientId) ?? null,
)

function place(id: string): string {
  const found = locations.value.find(location => location.id === id)
  return found ? locationLabel(found) : t('transfers.unknownPlace')
}

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
  if (canCorrectTransfer(ride.state))
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
  // Both only open a new form. They stay available after the Ride is closed.
  items.push({ label: t('transfers.duplicate'), icon: 'i-lucide-copy', onSelect: () => emit('duplicate') })
  items.push({ label: t('transfers.returnJourney'), icon: 'i-lucide-undo-2', onSelect: () => emit('returnJourney') })
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

    <dl
      v-if="!command"
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
      <dd>{{ place(ride.startLocationId) }}</dd>
      <dt>{{ t('transfers.end') }}</dt>
      <dd>{{ place(ride.endLocationId) }}</dd>
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
        <dd>{{ partnerLabel(ride.partnerId) }}</dd>
      </template>
      <dt>{{ t('transfers.status') }}</dt>
      <dd>{{ t(`transfers.states.${ride.state}`) }}</dd>
      <dt>{{ t('transfers.fields.price') }}</dt>
      <dd class="tabular-nums">
        {{ priceLabel(ride.price) }} · {{ t(`transfers.payments.${ride.payment}`) }}
      </dd>
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

    <RideAssign
      v-if="command === 'assign'"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
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
