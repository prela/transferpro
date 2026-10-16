<script setup lang="ts">
import type { Driver, TransferDayRide } from '../../shared'

const props = defineProps<{
  drivers: Driver[]
  loadDay: () => Promise<void>
}>()

const emit = defineEmits<{
  /** A confirmation saved. The detail closes so the list is usable again. */
  saved: []
}>()

async function reloadAfterSave() {
  await props.loadDay()
  emit('saved')
}

const clearDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const markDoneDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const markNoShowDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const cancelDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)

defineExpose({
  openClear: (ride: TransferDayRide) => clearDialog.value?.open(ride),
  openMarkDone: (ride: TransferDayRide) => markDoneDialog.value?.open(ride),
  openMarkNoShow: (ride: TransferDayRide) => markNoShowDialog.value?.open(ride),
  openCancelRide: (ride: TransferDayRide) => cancelDialog.value?.open(ride),
})
</script>

<template>
  <!--
    Confirmations stay modals: cancel, no-show, unassign, done (cannot be
    undone), and the overlap dialog inside each assignment form. ADR-0038.
  -->
  <RideClearDialog
    ref="clearDialog"
    :drivers="drivers"
    :load-day="reloadAfterSave"
  />
  <RideMarkDoneDialog
    ref="markDoneDialog"
    :load-day="reloadAfterSave"
  />
  <RideMarkNoShowDialog
    ref="markNoShowDialog"
    :load-day="reloadAfterSave"
  />
  <RideCancelDialog
    ref="cancelDialog"
    :drivers="drivers"
    :load-day="reloadAfterSave"
  />
</template>
