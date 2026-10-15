<script setup lang="ts">
import type { Driver, TransferDayRide, Vehicle } from '../../shared'
import { canRecordLandingTime } from '../../shared'
import { assignButtonId, changeVehicleButtonId, reassignRideButtonId } from '../transfer-ride-buttons'
import { canChangeAssignment } from '../transfer-ride-guards'

const props = defineProps<{
  rides: TransferDayRide[]
  drivers: Driver[]
  vehicles: Vehicle[]
  timeZone: string
  loadFailed: () => boolean
  loadDay: () => Promise<void>
  focusList: () => void
}>()

const assigning = ref<{ rideId: string, guestName: string } | null>(null)
const recordingLanding = ref<{ rideId: string, guestName: string, landingAt: string | null } | null>(null)
const changingVehicle = ref<{ rideId: string, guestName: string, vehicleId: string } | null>(null)
const reassigning = ref<{ rideId: string, guestName: string, driverId: string } | null>(null)

const clearDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const acceptByPhoneDialog = ref<{ open: (ride: TransferDayRide) => void, onDayChanged: () => void } | null>(null)
const markDoneDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const markNoShowDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)
const cancelDialog = ref<{ open: (ride: TransferDayRide) => void } | null>(null)

function focusAssignButton(rideId: string) {
  document.getElementById(assignButtonId(rideId))?.focus()
}

function openAssign(ride: TransferDayRide) {
  changingVehicle.value = null
  reassigning.value = null
  assigning.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function openLanding(ride: TransferDayRide) {
  // Finished Rides keep the time they have. The button is hidden; this is the same rule.
  if (!canRecordLandingTime(ride.state))
    return
  recordingLanding.value = {
    rideId: ride.rideId,
    guestName: ride.guestName,
    landingAt: ride.landingAt,
  }
}

async function onLandingSaved() {
  recordingLanding.value = null
  await props.loadDay()
}

function closeAssign() {
  const rideId = assigning.value?.rideId
  assigning.value = null
  if (!rideId)
    return
  void nextTick(() => {
    focusAssignButton(rideId)
  })
}

function openVehicleChange(ride: TransferDayRide) {
  if (!canChangeAssignment(ride) || ride.vehicleId === null)
    return
  assigning.value = null
  reassigning.value = null
  changingVehicle.value = { rideId: ride.rideId, guestName: ride.guestName, vehicleId: ride.vehicleId }
}

function openReassign(ride: TransferDayRide) {
  if (!canChangeAssignment(ride) || ride.driverId === null)
    return
  assigning.value = null
  changingVehicle.value = null
  reassigning.value = { rideId: ride.rideId, guestName: ride.guestName, driverId: ride.driverId }
}

function closeVehicleChange() {
  const rideId = changingVehicle.value?.rideId
  changingVehicle.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(changeVehicleButtonId(rideId))?.focus()
  })
}

function closeReassign() {
  const rideId = reassigning.value?.rideId
  reassigning.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(reassignRideButtonId(rideId))?.focus()
  })
}

async function onCommandSaved() {
  changingVehicle.value = null
  reassigning.value = null
  await props.loadDay()
  await nextTick()
  props.focusList()
}

/**
 * Next unassigned Ride after `afterRideId` in list order, wrapping to the first.
 * The assigned Ride is no longer unassigned, so it is skipped.
 */
function nextUnassignedRideId(afterRideId: string): string | null {
  const order = props.rides
  const start = order.findIndex(ride => ride.rideId === afterRideId)
  const from = start === -1 ? 0 : start + 1
  const wrapped = [...order.slice(from), ...order.slice(0, from)]
  return wrapped.find(ride => ride.state === 'unassigned')?.rideId ?? null
}

async function onAssigned() {
  const assignedRideId = assigning.value?.rideId
  assigning.value = null
  await props.loadDay()
  if (props.loadFailed() || !assignedRideId)
    return
  await nextTick()
  const nextId = nextUnassignedRideId(assignedRideId)
  if (nextId)
    focusAssignButton(nextId)
  else
    props.focusList()
}

function onDayChanged() {
  assigning.value = null
  // A different day is a different list. Close the phone dialog. That does not post.
  // The booking slideover stays open.
  acceptByPhoneDialog.value?.onDayChanged()
}

defineExpose({
  openAssign,
  openLanding,
  openVehicleChange,
  openReassign,
  openClear: (ride: TransferDayRide) => clearDialog.value?.open(ride),
  openAcceptByPhone: (ride: TransferDayRide) => acceptByPhoneDialog.value?.open(ride),
  openMarkDone: (ride: TransferDayRide) => markDoneDialog.value?.open(ride),
  openMarkNoShow: (ride: TransferDayRide) => markNoShowDialog.value?.open(ride),
  openCancelRide: (ride: TransferDayRide) => cancelDialog.value?.open(ride),
  onDayChanged,
})
</script>

<template>
  <RideLanding
    v-if="recordingLanding"
    :key="recordingLanding.rideId"
    :ride-id="recordingLanding.rideId"
    :guest-name="recordingLanding.guestName"
    :landing-at="recordingLanding.landingAt"
    :time-zone="timeZone"
    @saved="onLandingSaved"
    @cancel="recordingLanding = null"
  />

  <RideAssign
    v-if="assigning"
    :key="assigning.rideId"
    :ride-id="assigning.rideId"
    :guest-name="assigning.guestName"
    :drivers="drivers"
    :vehicles="vehicles"
    @assigned="onAssigned"
    @cancel="closeAssign"
  />

  <RideVehicle
    v-if="changingVehicle"
    :key="changingVehicle.rideId"
    :ride-id="changingVehicle.rideId"
    :guest-name="changingVehicle.guestName"
    :vehicle-id="changingVehicle.vehicleId"
    :drivers="drivers"
    :vehicles="vehicles"
    @saved="onCommandSaved"
    @cancel="closeVehicleChange"
  />

  <RideReassign
    v-if="reassigning"
    :key="reassigning.rideId"
    :ride-id="reassigning.rideId"
    :guest-name="reassigning.guestName"
    :driver-id="reassigning.driverId"
    :drivers="drivers"
    :vehicles="vehicles"
    @saved="onCommandSaved"
    @cancel="closeReassign"
  />

  <RideClearDialog
    ref="clearDialog"
    :drivers="drivers"
    :load-day="loadDay"
  />
  <RideAcceptByPhoneDialog
    ref="acceptByPhoneDialog"
    :load-day="loadDay"
  />
  <RideMarkDoneDialog
    ref="markDoneDialog"
    :load-day="loadDay"
  />
  <RideMarkNoShowDialog
    ref="markNoShowDialog"
    :load-day="loadDay"
  />
  <RideCancelDialog
    ref="cancelDialog"
    :drivers="drivers"
    :load-day="loadDay"
  />
</template>
