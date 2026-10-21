<script setup lang="ts">
import type { DisplayLocale, Driver, LiveRefreshOutcome, TransferDayRide } from '../../shared'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'

const props = defineProps<{
  drivers: Driver[]
  rides: TransferDayRide[]
  timeZone: string
  locale: DisplayLocale
  loadDay: () => Promise<LiveRefreshOutcome | void>
}>()

const emit = defineEmits<{
  /** A clean confirmation. No-email and send-failed leave the detail open. */
  saved: []
}>()

const { takeHold } = useWorkOrderPresenter()

async function reloadAfterSave() {
  await props.loadDay()
  if (!takeHold())
    emit('saved')
}

const clearDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const takeBackDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const markDoneDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const markNoShowDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const cancelDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)

defineExpose({
  openClear: (ride: TransferDayRide) => clearDialog.value?.open(ride),
  openTakeBack: (ride: TransferDayRide) => takeBackDialog.value?.open(ride),
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
    :rides="rides"
    :time-zone="timeZone"
    :locale="locale"
    :load-day="reloadAfterSave"
    :reload-day="() => props.loadDay()"
  />
  <RideTakeBackDialog
    ref="takeBackDialog"
    :rides="rides"
    :time-zone="timeZone"
    :locale="locale"
    :load-day="reloadAfterSave"
    :reload-day="() => props.loadDay()"
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
