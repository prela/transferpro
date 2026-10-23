<script setup lang="ts">
import type { Client, ClientOfficeBrief, DisplayLocale, Driver, OfficeLocation, TransferDayRide } from '../../shared'
import { transferFormKey } from '../composables/transfer-form'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  operationalDayStartHour: number
  tenantId: string
  userId: string
  clients: Client[]
  /** Live contact persons and the Client note. The form shows the note only. */
  clientBriefs: ClientOfficeBrief[]
  drivers: Driver[]
  loadDay: () => Promise<void>
  /** The new-Transfer panel stores a browser draft. A correction does not. */
  persistDraft?: boolean
  /** Correction renders in the Ride detail. A new Transfer uses the same panel. */
  inPanel?: boolean
  /** Set when this instance is the detail's correction form. */
  correctRide?: TransferDayRide | null
  /** Phone uses the large targets. The office desktop uses the small size. */
  phone?: boolean
  /** 409 stale_save on a correction. Awaited so the notice is up before the button enables. */
  onStale?: () => Promise<void>
  /**
   * The main Transfer after the day reloads. An extra-vehicle save sends
   * that version. A correction leaves this unset and uses `onStale`.
   */
  lookupMain?: () => {
    readonly version: number
    readonly groupPassengerCountStored: boolean
    readonly changedByName: string | null
    readonly changedAt: string | null
  } | null
}>()

const emit = defineEmits<{
  recorded: [rideId: string]
  close: []
}>()

const day = defineModel<string>('day', { required: true })
const saved = defineModel<boolean>('saved', { required: true })
const corrected = defineModel<boolean>('corrected', { required: true })
const locations = defineModel<OfficeLocation[]>('locations', { required: true })
const clients = defineModel<Client[]>('clients', { required: true })

const onStale = props.onStale

const api = useTransferForm({
  timeZone: () => props.timeZone,
  locale: () => props.locale,
  operationalDayStartHour: () => props.operationalDayStartHour,
  tenantId: () => props.tenantId,
  userId: () => props.userId,
  persistDraft: props.persistDraft === true,
  clients: () => clients.value,
  drivers: () => props.drivers,
  locations,
  day,
  loadDay: () => props.loadDay(),
  saved,
  corrected,
  onClient: (client) => {
    clients.value = [...clients.value, client].sort((left, right) => left.name.localeCompare(right.name))
  },
  onRecorded: rideId => emit('recorded', rideId),
  onClose: () => emit('close'),
  onStale: onStale === undefined ? undefined : () => onStale(),
  lookupMain: props.lookupMain,
})
provide(transferFormKey, api)

const {
  pending,
  refusalOpen,
  refusalReason,
  formMode,
  formOpen,
  formTitle,
  openAdd,
  openPrefill,
  openCorrect,
  saveCorrection,
  mainTransferId,
  staleNotice,
  staleChangedByName,
  staleChangedAt,
  refreshExtraStale,
} = api

defineExpose({
  openAdd,
  openPrefill,
  openCorrect,
  formTitle,
  formMode,
  formOpen,
  pending,
  mainTransferId,
})

watch(() => props.correctRide?.rideId, (rideId) => {
  const ride = props.correctRide
  // A later refresh of the same Ride must not replace what the user typed.
  if (props.inPanel && ride && rideId)
    openCorrect(ride)
}, { immediate: true })
</script>

<template>
  <div
    v-if="formMode"
    role="region"
    :aria-label="formTitle"
  >
    <h2 class="mb-4 text-lg font-semibold">
      {{ formTitle }}
    </h2>
    <StaleSaveAlert
      v-if="staleNotice"
      :changed-by-name="staleChangedByName"
      :changed-at="staleChangedAt"
      :time-zone="timeZone"
      :locale="locale"
      :phone="phone"
      :pending="pending"
      @refresh="refreshExtraStale"
    />
    <TransferFormFields
      :control-size="phone ? 'xl' : 'sm'"
      :client-briefs="clientBriefs"
    />
  </div>
  <RideOverlapDialog
    v-model:open="refusalOpen"
    :pending="pending"
    :reason="refusalReason"
    @confirm="saveCorrection(true)"
  />
</template>
