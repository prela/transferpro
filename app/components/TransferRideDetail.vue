<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Client, DisplayLocale, Driver, Location, TransferDayRide, Vehicle } from '../../shared'
import type { RideDetailCommand } from '../ride-detail'
import { canCorrectTransfer, canRecordLandingTime, classifyRideAttention, formatInstant } from '../../shared'
import { useKeptWorkOrders } from '../composables/kept-work-orders'
import { rideFormStamp } from '../ride-detail'
import { driverDisplayName } from '../transfer-day-labels'
import { canCallOff, canChangeAssignment, canFinish, canNoShow, canRecordAcceptanceByPhone } from '../transfer-ride-guards'
import { workOrderNotice } from '../work-order-notice'

const props = defineProps<{
  ride: TransferDayRide
  command: RideDetailCommand | null
  drivers: Driver[]
  vehicles: Vehicle[]
  declines: { driverName: string }[]
  timeZone: string
  locale: DisplayLocale
  nowMs: number
  dayRides: TransferDayRide[]
  /** Phone uses the driver list. Desktop uses the selects. */
  listDrivers: boolean
  /** Phone keeps the action bar on screen while the body scrolls. */
  pinActions: boolean
  loadDay: () => Promise<void>
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
const correctForm = ref<{ formMode: 'add' | 'edit' | null } | null>(null)

watch(() => correctForm.value?.formMode, (mode, previous) => {
  // Cancel closes the form. Facts and the commands come back. A save sets
  // corrected and the day closes the detail on its own.
  if (props.command === 'correct' && previous === 'edit' && mode !== 'edit' && !corrected.value)
    emit('command', null)
})

const snapshot = ref<TransferDayRide | null>(null)
const rideChanged = ref(false)

watch(() => props.command, (command) => {
  if (command) {
    snapshot.value = props.ride
    rideChanged.value = false
    return
  }
  snapshot.value = null
  rideChanged.value = false
}, { immediate: true })

watch(() => props.ride, (ride) => {
  if (!props.command || !snapshot.value)
    return
  if (rideFormStamp(ride) !== rideFormStamp(snapshot.value))
    rideChanged.value = true
})

const formRide = computed(() => (props.command && snapshot.value ? snapshot.value : props.ride))

const notices = computed(() => kept.value.filter(entry =>
  entry.rideId === props.ride.rideId || entry.rideId === props.ride.transferId,
))

const attention = computed(() => classifyRideAttention(props.ride, props.declines, props.nowMs))

function place(id: string): string {
  return locations.value.find(location => location.id === id)?.name ?? t('transfers.unknownPlace')
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
  if (primary.value === null && canFinish(ride))
    items.push({ label: t('ride.markDone'), onSelect: () => emit('done') })
  return items.length > 0 ? [items] : []
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

    <UAlert
      v-for="notice in notices"
      :key="notice.id"
      :color="notice.outcome === 'failed' ? 'error' : 'warning'"
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
      <dt>{{ t('ride.driver') }}</dt>
      <dd>{{ driverDisplayName(drivers, ride.driverId, t('ride.unknownDriver')) || t('transfers.unassignedCrew') }}</dd>
      <dt>{{ t('ride.vehicle') }}</dt>
      <dd class="font-mono">
        {{ plate(ride.vehicleId) || t('transfers.unassignedCrew') }}
      </dd>
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
      @assigned="emit('saved')"
      @cancel="emit('command', null)"
    />
    <RideVehicle
      v-else-if="command === 'vehicle' && formRide.vehicleId"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
      :vehicle-id="formRide.vehicleId"
      :drivers="drivers"
      :vehicles="vehicles"
      :phone="pinActions"
      @saved="emit('saved')"
      @cancel="emit('command', null)"
    />
    <RideReassign
      v-else-if="command === 'reassign' && formRide.driverId"
      :ride-id="formRide.rideId"
      :guest-name="formRide.guestName"
      :driver-id="formRide.driverId"
      :drivers="drivers"
      :vehicles="vehicles"
      :phone="pinActions"
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
    <RideAcceptByPhoneDialog
      v-else-if="command === 'accept'"
      :ride="formRide"
      :load-day="loadDay"
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
      in-panel
      :phone="pinActions"
      :correct-ride="formRide"
      :time-zone="timeZone"
      :locale="locale"
      :operational-day-start-hour="operationalDayStartHour"
      :tenant-id="tenantId"
      :user-id="userId"
      :drivers="drivers"
      :load-day="loadDay"
    />

    <div
      v-if="!command"
      class="flex items-center gap-2 bg-default"
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
