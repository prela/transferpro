<script setup lang="ts">
import type { Client, DisplayLocale, Driver, Location, TransferDayRide } from '../../shared'
import { transferFormKey } from '../composables/transfer-form'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  operationalDayStartHour: number
  tenantId: string
  clients: Client[]
  drivers: Driver[]
  loadDay: () => Promise<void>
  /** Correction renders in the Ride detail. A new Transfer stays a slideover. */
  inPanel?: boolean
  /** Set when this instance is the detail's correction form. */
  correctRide?: TransferDayRide | null
  /** Phone uses the large targets. Desktop correction uses the office size. */
  phone?: boolean
}>()

const day = defineModel<string>('day', { required: true })
const saved = defineModel<boolean>('saved', { required: true })
const corrected = defineModel<boolean>('corrected', { required: true })
const locations = defineModel<Location[]>('locations', { required: true })

const api = useTransferForm({
  timeZone: () => props.timeZone,
  locale: () => props.locale,
  operationalDayStartHour: () => props.operationalDayStartHour,
  tenantId: () => props.tenantId,
  clients: () => props.clients,
  drivers: () => props.drivers,
  locations,
  day,
  loadDay: () => props.loadDay(),
  saved,
  corrected,
})
provide(transferFormKey, api)

const {
  pending,
  placePending,
  overlapOpen,
  formMode,
  formOpen,
  formTitle,
  openAdd,
  openCorrect,
  saveCorrection,
} = api

defineExpose({ openAdd, openCorrect, formTitle, formMode, formOpen })

watch(() => props.correctRide?.rideId, (rideId) => {
  const ride = props.correctRide
  // A later refresh of the same Ride must not replace what the user typed.
  if (props.inPanel && ride && rideId)
    openCorrect(ride)
}, { immediate: true })
</script>

<template>
  <!--
    A correction is a child of the Ride detail. A new Transfer keeps the
    slideover, including when a restored draft has no panel to land in.
  -->
  <div
    v-if="inPanel && formMode === 'edit'"
    role="region"
    :aria-label="formTitle"
  >
    <h2 class="mb-4 text-lg font-semibold">
      {{ formTitle }}
    </h2>
    <TransferFormFields :control-size="inPanel && !phone ? 'sm' : 'xl'" />
  </div>
  <USlideover
    v-else-if="!inPanel"
    v-model:open="formOpen"
    :title="formTitle"
    :dismissible="!pending && !placePending"
  >
    <template #body>
      <TransferFormFields :control-size="inPanel && !phone ? 'sm' : 'xl'" />
    </template>
  </USlideover>
  <RideOverlapDialog
    v-model:open="overlapOpen"
    :pending="pending"
    @confirm="saveCorrection(true)"
  />
</template>
