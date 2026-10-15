<script setup lang="ts">
import type { DeclineAlert, DisplayLocale, TransferDayRide } from '../../shared'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  operationalDayStartHour: number
  tenantId: string
}>()

const { t } = useI18n()

const saved = ref(false)
const corrected = ref(false)

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

function focusList() {
  table.value?.focusList()
}

function loadFailed() {
  return loadError.value
}

watch(day, () => {
  commands.value?.onDayChanged()
  void loadDay()
})

onMounted(() => {
  void loadAll()
})

/** The alert names the Driver and the guest, both joined when the day is read. */
function declineAlertText(alert: DeclineAlert): string {
  return t('transfers.declined', {
    driver: alert.driverName,
    guest: alert.guestName,
  })
}
</script>

<template>
  <section>
    <TransferDayToolbar
      v-model:day="day"
      :loading="loading"
      @refresh="loadDay()"
      @add="form?.openAdd()"
    />
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
    <!-- The alert is not a branch of the list. A declined Ride is unassigned and still on the board. -->
    <ul
      v-if="!loadError && !loading && declineAlerts.length > 0"
      class="mb-4 flex flex-col gap-2"
    >
      <li
        v-for="alert in declineAlerts"
        :key="alert.id"
      >
        <UAlert
          color="warning"
          variant="subtle"
          role="alert"
          icon="i-lucide-user-x"
          :description="declineAlertText(alert)"
        />
      </li>
    </ul>
    <TransferRideTable
      ref="table"
      :rides="rides"
      :loading="loading"
      :load-error="loadError"
      :locations="locations"
      :drivers="drivers"
      :vehicles="vehicles"
      :time-zone="timeZone"
      :locale="locale"
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
    />

    <TransferRideCommands
      ref="commands"
      :rides="rides"
      :drivers="drivers"
      :vehicles="vehicles"
      :time-zone="timeZone"
      :load-failed="loadFailed"
      :load-day="loadDay"
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
      :load-day="loadDay"
    />
  </section>
</template>
