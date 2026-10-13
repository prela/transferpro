<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Client, DeclineAlert, DisplayLocale, Driver, Location, LocationKind, PaymentMethod, TransferDayRide, Vehicle } from '../../shared'
import { z } from 'zod'
import { assignedRideSchema, calendarDateInTimeZone, canCancelRide, cancelledRideResultSchema, canCorrectTransfer, canMarkNoShow, canMarkRideDone, canRecordLandingTime, childSeatCountError, clientListSchema, driverListSchema, flightNumberError, formatInstant, guestNameError, instantFromWallClock, isCalendarDate, locationKindError, locationKindSchema, locationListSchema, locationNameError, locationSchema, luggageCountError, noteError, operationalDateInTimeZone, passengerCountError, paymentMethodSchema, pickupAtError, priceError, priceFromInput, recordedTransferSchema, rideSchema, sameLocationError, tablaError, transferDaySchema, vehicleListSchema, wallClockInTimeZone } from '../../shared'
import { workOrderNotice } from '../work-order-notice'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  operationalDayStartHour: number
  tenantId: string
}>()

const { t } = useI18n()
const toast = useToast()
const { notifyAuditChanged } = useAuditRefresh()

// The board opens on the operational day that contains now. A pickup form
// still defaults to noon on the calendar date: recording a pickup did not move.
const day = ref(operationalDateInTimeZone(props.timeZone, new Date(), props.operationalDayStartHour))
const pickupDay = calendarDateInTimeZone(props.timeZone, new Date())
const rides = ref<TransferDayRide[]>([])
const declineAlerts = ref<DeclineAlert[]>([])
const clients = ref<Client[]>([])
const locations = ref<Location[]>([])
const drivers = ref<Driver[]>([])
const vehicles = ref<Vehicle[]>([])
const assigning = ref<{ rideId: string, guestName: string } | null>(null)
const recordingLanding = ref<{ rideId: string, guestName: string, landingAt: string | null } | null>(null)
const changingVehicle = ref<{ rideId: string, guestName: string, vehicleId: string } | null>(null)
const reassigning = ref<{ rideId: string, guestName: string, driverId: string } | null>(null)
const clearing = ref<{ rideId: string, guestName: string } | null>(null)
const clearPending = ref(false)
const clearErrorKey = ref<'ride.notOpen' | 'ride.notFound' | 'ride.signedOut' | 'ride.changeFailed' | null>(null)
// The Ride whose phone confirmation the office is about to record. Null closes the dialog.
const acceptingByPhone = ref<{ rideId: string, guestName: string } | null>(null)
const acceptByPhonePending = ref(false)
const acceptByPhoneErrorKey = ref<AcceptByPhoneFailure | null>(null)
const markingDone = ref<{ rideId: string, guestName: string } | null>(null)
const markDonePending = ref(false)
const markDoneErrorKey = ref<MarkDoneFailure | null>(null)
const markingNoShow = ref<{ rideId: string, guestName: string } | null>(null)
const markNoShowPending = ref(false)
const markNoShowErrorKey = ref<MarkNoShowFailure | null>(null)
const cancelling = ref<{ rideId: string, guestName: string } | null>(null)
const cancelPending = ref(false)
const cancelErrorKey = ref<CancelRideFailure | null>(null)
const dayListRegion = ref<HTMLElement | null>(null)

const clientId = ref<string | undefined>()
const pickupWall = ref(`${pickupDay}T12:00`)
const startLocationId = ref<string | undefined>()
const endLocationId = ref<string | undefined>()
const passengers = ref('1')
const guest = ref('')
const tabla = ref('')
const flight = ref('')
const price = ref('')
const payment = ref<PaymentMethod | undefined>()
const airportMark = ref(false)
const luggage = ref('0')
const childSeats = ref('0')
const note = ref('')

const placeTarget = ref<'start' | 'end' | null>(null)
const placeName = ref('')
const placeKind = ref<LocationKind | undefined>()
const placeAddress = ref('')

const loading = ref(true)
const loadError = ref(false)
const pending = ref(false)
const placePending = ref(false)
const saved = ref(false)
const corrected = ref(false)
/**
 * Add and correct share one slideover. Null is closed.
 * `edit` patches the Transfer in `editingTransferId`.
 */
const formMode = ref<'add' | 'edit' | null>(null)
const editingTransferId = ref<string | null>(null)
const formErrorKey = ref<TransferFailure | null>(null)
const guestErrorKey = ref<'transfers.guestEmpty' | 'transfers.guestTooLong' | null>(null)
const tablaErrorKey = ref<'transfers.tablaTooLong' | null>(null)
const flightErrorKey = ref<'transfers.flightTooLong' | null>(null)
const noteErrorKey = ref<'transfers.noteTooLong' | null>(null)
const priceErrorKey = ref<'transfers.priceInvalid' | null>(null)
const passengerErrorKey = ref<'transfers.countInvalid' | null>(null)
const luggageErrorKey = ref<'transfers.countInvalid' | null>(null)
const seatErrorKey = ref<'transfers.countInvalid' | null>(null)
const pickupErrorKey = ref<'transfers.pickupInvalid' | 'transfers.pickupTooEarly' | 'transfers.pickupTooLate' | null>(null)
const endErrorKey = ref<'transfers.samePlace' | null>(null)
const placeNameErrorKey = ref<'locations.nameEmpty' | 'locations.nameTooLong' | null>(null)
const placeKindErrorKey = ref<'locations.kindInvalid' | null>(null)

type TransferFailure
  = 'transfers.rejected'
    | 'transfers.notFound'
    | 'transfers.forbidden'
    | 'transfers.signedOut'
    | 'transfers.saveFailed'
    | 'transfers.locationArchived'
    | 'transfers.closed'
    | 'locations.saveFailed'

type AcceptByPhoneFailure
  = 'ride.acceptByPhoneFailed'
    | 'ride.acceptByPhoneConflict'
    | 'ride.signedOut'

type MarkDoneFailure
  = 'ride.markDoneFailed'
    | 'ride.markDoneConflict'
    | 'ride.signedOut'

type MarkNoShowFailure
  = 'ride.markNoShowFailed'
    | 'ride.markNoShowConflict'
    | 'ride.signedOut'

type CancelRideFailure
  = 'ride.cancelRideFailed'
    | 'ride.cancelRideConflict'
    | 'ride.signedOut'

let loadTicket = 0

const clientItems = computed(() => clients.value.map(client => ({
  label: client.name,
  value: client.id,
})))

const locationItems = computed(() => locations.value
  .filter(location => location.archivedAt === null)
  .map(location => ({ label: location.name, value: location.id })))

const paymentItems = computed(() => [
  { label: t('transfers.payments.cash'), value: 'cash' as const },
  { label: t('transfers.payments.card'), value: 'card' as const },
  { label: t('transfers.payments.invoice_to_agency'), value: 'invoice_to_agency' as const },
])

const kindItems = computed(() => [
  { label: t('locations.kinds.airport'), value: 'airport' as const },
  { label: t('locations.kinds.hotel'), value: 'hotel' as const },
  { label: t('locations.kinds.address'), value: 'address' as const },
  { label: t('locations.kinds.other'), value: 'other' as const },
])

// Reserved ride states are labeled. This screen does not set them.
const columns = computed(() => [
  { id: 'pickup', header: t('transfers.pickupAt') },
  { id: 'landing', header: t('transfers.fields.landingAt') },
  { id: 'expectedArrival', header: t('transfers.fields.expectedArrival') },
  { accessorKey: 'guestName' as const, header: t('transfers.guest') },
  { id: 'tabla', header: t('transfers.tabla') },
  { id: 'start', header: t('transfers.start') },
  { id: 'end', header: t('transfers.end') },
  { id: 'state', header: t('transfers.status') },
  { id: 'driver', header: t('ride.driver') },
  { id: 'vehicle', header: t('ride.vehicle') },
  { id: 'actions', header: t('ride.actions') },
])

function placeLabel(id: string): string {
  return locations.value.find(location => location.id === id)?.name ?? t('transfers.unknownPlace')
}

/** The day list stores ids. The screen shows the name or the plate, never the id. */
function driverLabel(id: string | null): string {
  if (id === null)
    return ''
  return drivers.value.find(driver => driver.id === id)?.name ?? t('ride.unknownDriver')
}

/** The alert names the Driver and the guest, both joined when the day is read. */
function declineAlertText(alert: DeclineAlert): string {
  return t('transfers.declined', {
    driver: alert.driverName,
    guest: alert.guestName,
  })
}

function vehicleLabel(id: string | null): string {
  if (id === null)
    return ''
  return vehicles.value.find(vehicle => vehicle.id === id)?.registrationPlate ?? t('ride.unknownVehicle')
}

function vehicleArchived(id: string | null): boolean {
  if (id === null)
    return false
  const vehicle = vehicles.value.find(item => item.id === id)
  return vehicle !== undefined && vehicle.archivedAt !== null
}

function assignButtonId(rideId: string): string {
  return `assign-ride-${rideId}`
}

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
  await loadDay()
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

/**
 * The copied flag and `assigned` are both required. An accepted Ride still
 * has the flag, and an assigned Ride that does not require acceptance has
 * no control. The flag is the copy on the Ride, not the Driver's current setting.
 */
function canRecordAcceptanceByPhone(ride: TransferDayRide): boolean {
  return ride.state === 'assigned' && ride.mustAccept === true
}

/** Flag off from `assigned`. Flag on only from `accepted`. Unassigned has no control. */
function canFinish(ride: TransferDayRide): boolean {
  return canMarkRideDone(ride.state, ride.mustAccept)
}

/** The same source state as done. The office may mark a No-show before the wait. */
function canNoShow(ride: TransferDayRide): boolean {
  return canMarkNoShow(ride.state, ride.mustAccept)
}

/** Unassigned, assigned, or accepted. A terminal Ride has no control. The Driver cannot cancel. */
function canCallOff(ride: TransferDayRide): boolean {
  return canCancelRide(ride.state)
}

/** Assigned or accepted, with both a Driver and a Vehicle. Those are the three office commands. */
function canChangeAssignment(ride: TransferDayRide): boolean {
  return (ride.state === 'assigned' || ride.state === 'accepted')
    && ride.driverId !== null
    && ride.vehicleId !== null
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
    document.getElementById(`change-vehicle-${rideId}`)?.focus()
  })
}

function closeReassign() {
  const rideId = reassigning.value?.rideId
  reassigning.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(`reassign-ride-${rideId}`)?.focus()
  })
}

async function onCommandSaved() {
  changingVehicle.value = null
  reassigning.value = null
  await loadDay()
  await nextTick()
  dayListRegion.value?.focus()
}

function openClear(ride: TransferDayRide) {
  if (!canChangeAssignment(ride) || clearPending.value)
    return
  clearErrorKey.value = null
  clearing.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeClear() {
  if (clearPending.value)
    return
  const rideId = clearing.value?.rideId
  clearErrorKey.value = null
  clearing.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(`clear-ride-${rideId}`)?.focus()
  })
}

const clearOpen = computed({
  get: () => clearing.value !== null,
  set(open: boolean) {
    if (!open)
      closeClear()
  },
})

async function confirmClear() {
  const target = clearing.value
  if (!target || clearPending.value)
    return
  clearPending.value = true
  clearErrorKey.value = null
  try {
    const cleared = assignedRideSchema.parse(await $fetch(`/api/rides/${target.rideId}/clear`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    // The notice names the Driver who lost the Ride. The address is not on the response.
    const notice = cleared.workOrders[0]
    const shown = notice === undefined ? undefined : workOrderNotice(notice.outcome)
    toast.add({
      title: t('ride.cleared'),
      description: shown === undefined || notice === undefined ? undefined : t(shown.key, { name: driverLabel(notice.driverId) }),
      color: shown?.color ?? 'success',
    })
    clearing.value = null
    await loadDay()
  }
  catch (error) {
    if (errorCode(error) === 'ride_not_open')
      clearErrorKey.value = 'ride.notOpen'
    else if (httpStatus(error) === 401)
      clearErrorKey.value = 'ride.signedOut'
    else if (httpStatus(error) === 404)
      clearErrorKey.value = 'ride.notFound'
    else
      clearErrorKey.value = 'ride.changeFailed'
    if (httpStatus(error) === 409)
      await loadDay()
  }
  finally {
    clearPending.value = false
  }
}

function acceptByPhoneButtonId(rideId: string): string {
  return `accept-by-phone-${rideId}`
}

function openAcceptByPhone(ride: TransferDayRide) {
  if (!canRecordAcceptanceByPhone(ride) || acceptByPhonePending.value)
    return
  acceptByPhoneErrorKey.value = null
  acceptingByPhone.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeAcceptByPhone() {
  // Leave the dialog up while the post is in flight. Closing would not undo it.
  if (acceptByPhonePending.value)
    return
  const rideId = acceptingByPhone.value?.rideId
  acceptByPhoneErrorKey.value = null
  acceptingByPhone.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(acceptByPhoneButtonId(rideId))?.focus()
  })
}

// Esc, the overlay, and the close control write nothing. Cancel uses the same path.
const acceptByPhoneOpen = computed({
  get: () => acceptingByPhone.value !== null,
  set(open: boolean) {
    if (!open)
      closeAcceptByPhone()
  },
})

function acceptByPhoneFailureKey(error: unknown): AcceptByPhoneFailure {
  // 409 is ride_not_acceptable: the flag is off, or the Ride is no longer assigned.
  if (httpStatus(error) === 409)
    return 'ride.acceptByPhoneConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.acceptByPhoneFailed'
}

/**
 * POST /api/rides/:id/accept-by-phone with an empty body. There is no note.
 * Success reloads the day so the row shows Accepted. Cancel never calls this.
 * This action does not send mail.
 */
async function confirmAcceptByPhone() {
  const target = acceptingByPhone.value
  if (!target || acceptByPhonePending.value)
    return
  acceptByPhonePending.value = true
  acceptByPhoneErrorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${target.rideId}/accept-by-phone`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    acceptingByPhone.value = null
    await loadDay()
  }
  catch (error) {
    acceptByPhoneErrorKey.value = acceptByPhoneFailureKey(error)
    // The list the office confirmed was already stale. Reload so the control follows the row.
    if (httpStatus(error) === 409)
      await loadDay()
  }
  finally {
    acceptByPhonePending.value = false
  }
}

function markDoneButtonId(rideId: string): string {
  return `mark-done-${rideId}`
}

function openMarkDone(ride: TransferDayRide) {
  if (!canFinish(ride) || markDonePending.value)
    return
  markDoneErrorKey.value = null
  markingDone.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeMarkDone() {
  if (markDonePending.value)
    return
  const rideId = markingDone.value?.rideId
  markDoneErrorKey.value = null
  markingDone.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(markDoneButtonId(rideId))?.focus()
  })
}

const markDoneOpen = computed({
  get: () => markingDone.value !== null,
  set(open: boolean) {
    if (!open)
      closeMarkDone()
  },
})

function markDoneFailureKey(error: unknown): MarkDoneFailure {
  if (httpStatus(error) === 409)
    return 'ride.markDoneConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.markDoneFailed'
}

/**
 * POST /api/rides/:id/done with an empty body. Success reloads the day.
 * The Ride stays on the day list and shows Done. Cancel writes nothing.
 * This action does not send mail.
 */
async function confirmMarkDone() {
  const target = markingDone.value
  if (!target || markDonePending.value)
    return
  markDonePending.value = true
  markDoneErrorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${target.rideId}/done`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    markingDone.value = null
    await loadDay()
  }
  catch (error) {
    markDoneErrorKey.value = markDoneFailureKey(error)
    if (httpStatus(error) === 409)
      await loadDay()
  }
  finally {
    markDonePending.value = false
  }
}

function markNoShowButtonId(rideId: string): string {
  return `mark-no-show-${rideId}`
}

function openMarkNoShow(ride: TransferDayRide) {
  if (!canNoShow(ride) || markNoShowPending.value)
    return
  markNoShowErrorKey.value = null
  markingNoShow.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeMarkNoShow() {
  if (markNoShowPending.value)
    return
  const rideId = markingNoShow.value?.rideId
  markNoShowErrorKey.value = null
  markingNoShow.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(markNoShowButtonId(rideId))?.focus()
  })
}

const markNoShowOpen = computed({
  get: () => markingNoShow.value !== null,
  set(open: boolean) {
    if (!open)
      closeMarkNoShow()
  },
})

function markNoShowFailureKey(error: unknown): MarkNoShowFailure {
  if (httpStatus(error) === 409)
    return 'ride.markNoShowConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.markNoShowFailed'
}

/**
 * POST /api/rides/:id/no-show with an empty body. Success reloads the day.
 * The Ride stays on the day list and shows No-show. The office may do this
 * before the wait. Cancel writes nothing. No fee is stored. No mail is sent.
 */
async function confirmMarkNoShow() {
  const target = markingNoShow.value
  if (!target || markNoShowPending.value)
    return
  markNoShowPending.value = true
  markNoShowErrorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${target.rideId}/no-show`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    markingNoShow.value = null
    await loadDay()
  }
  catch (error) {
    markNoShowErrorKey.value = markNoShowFailureKey(error)
    if (httpStatus(error) === 409)
      await loadDay()
  }
  finally {
    markNoShowPending.value = false
  }
}

function cancelRideButtonId(rideId: string): string {
  return `cancel-ride-${rideId}`
}

function openCancelRide(ride: TransferDayRide) {
  if (!canCallOff(ride) || cancelPending.value)
    return
  cancelErrorKey.value = null
  cancelling.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function closeCancelRide() {
  if (cancelPending.value)
    return
  const rideId = cancelling.value?.rideId
  cancelErrorKey.value = null
  cancelling.value = null
  if (!rideId)
    return
  void nextTick(() => {
    document.getElementById(cancelRideButtonId(rideId))?.focus()
  })
}

const cancelRideOpen = computed({
  get: () => cancelling.value !== null,
  set(open: boolean) {
    if (!open)
      closeCancelRide()
  },
})

function cancelRideFailureKey(error: unknown): CancelRideFailure {
  if (httpStatus(error) === 409)
    return 'ride.cancelRideConflict'
  if (httpStatus(error) === 401)
    return 'ride.signedOut'
  return 'ride.cancelRideFailed'
}

/**
 * POST /api/rides/:id/cancel with an empty body. Success reloads the day.
 * The Ride stays on the day list and shows Cancelled. Dismiss writes nothing.
 * The notice names the current Driver. A Ride with no Driver has no notice.
 * The address is not on the response.
 */
async function confirmCancelRide() {
  const target = cancelling.value
  if (!target || cancelPending.value)
    return
  cancelPending.value = true
  cancelErrorKey.value = null
  try {
    const cancelled = cancelledRideResultSchema.parse(await $fetch(`/api/rides/${target.rideId}/cancel`, {
      method: 'POST',
      body: {},
    }))
    notifyAuditChanged()
    const notice = cancelled.workOrders[0]
    const shown = notice === undefined ? undefined : workOrderNotice(notice.outcome)
    toast.add({
      title: t('ride.cancelled'),
      description: shown === undefined || notice === undefined ? undefined : t(shown.key, { name: driverLabel(notice.driverId) }),
      color: shown?.color ?? 'success',
    })
    cancelling.value = null
    await loadDay()
  }
  catch (error) {
    cancelErrorKey.value = cancelRideFailureKey(error)
    if (httpStatus(error) === 409)
      await loadDay()
  }
  finally {
    cancelPending.value = false
  }
}

/**
 * Next unassigned Ride after `afterRideId` in list order, wrapping to the first.
 * The assigned Ride is no longer unassigned, so it is skipped.
 */
function nextUnassignedRideId(afterRideId: string): string | null {
  const order = rides.value
  const start = order.findIndex(ride => ride.rideId === afterRideId)
  const from = start === -1 ? 0 : start + 1
  const wrapped = [...order.slice(from), ...order.slice(0, from)]
  return wrapped.find(ride => ride.state === 'unassigned')?.rideId ?? null
}

async function onAssigned() {
  const assignedRideId = assigning.value?.rideId
  assigning.value = null
  await loadDay()
  if (loadError.value || !assignedRideId)
    return
  await nextTick()
  const nextId = nextUnassignedRideId(assignedRideId)
  if (nextId)
    focusAssignButton(nextId)
  else
    dayListRegion.value?.focus()
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error))
    return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('code' in data))
    return undefined
  return typeof data.code === 'string' ? data.code : undefined
}

function failureKey(error: unknown): TransferFailure {
  if (errorCode(error) === 'location_archived')
    return 'transfers.locationArchived'
  if (errorCode(error) === 'transfer_closed')
    return 'transfers.closed'
  switch (httpStatus(error)) {
    case 400: return 'transfers.rejected'
    case 401: return 'transfers.signedOut'
    case 403: return 'transfers.forbidden'
    case 404: return 'transfers.notFound'
    default: return 'transfers.saveFailed'
  }
}

async function fetchCatalogs() {
  // Each $fetch is a Promise.all item. Awaiting inside the array would run them one after another.
  const [clientList, locationList, driverList, vehicleList] = await Promise.all([
    $fetch('/api/clients').then(data => clientListSchema.parse(data)),
    // Archived rows stay in the catalog so a Ride keeps its place name.
    // The record form still offers only places that are not archived.
    $fetch('/api/locations', { query: { includeArchived: 'true' } }).then(data => locationListSchema.parse(data)),
    $fetch('/api/drivers').then(data => driverListSchema.parse(data)),
    // Archived Vehicles stay in the catalog so an assigned Ride keeps its plate.
    // The assign picker still offers only Vehicles that are not archived.
    $fetch('/api/vehicles', { query: { includeArchived: 'true' } }).then(data => vehicleListSchema.parse(data)),
  ])
  return {
    clients: clientList.clients,
    locations: locationList.locations,
    drivers: driverList.drivers,
    vehicles: vehicleList.vehicles,
  }
}

function applyCatalogs(catalogs: Awaited<ReturnType<typeof fetchCatalogs>>) {
  clients.value = catalogs.clients
  locations.value = catalogs.locations
  drivers.value = catalogs.drivers
  vehicles.value = catalogs.vehicles
}

async function fetchTransferDay(date: string) {
  return transferDaySchema.parse(await $fetch('/api/transfers', { query: { date } }))
}

async function loadDay(ticket = ++loadTicket) {
  if (!isCalendarDate(day.value))
    return
  loading.value = true
  loadError.value = false
  try {
    const listed = await fetchTransferDay(day.value)
    if (ticket !== loadTicket)
      return
    rides.value = listed.rides
    declineAlerts.value = listed.declineAlerts
  }
  catch {
    if (ticket !== loadTicket)
      return
    loadError.value = true
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

async function loadAll() {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = false
  try {
    const dayPromise = isCalendarDate(day.value)
      ? fetchTransferDay(day.value)
      : Promise.resolve(null)
    const [catalogs, listed] = await Promise.all([fetchCatalogs(), dayPromise])
    // A day change during this load must not drop the catalogs. The newer
    // day read already replaced the rows.
    applyCatalogs(catalogs)
    if (ticket !== loadTicket)
      return
    if (listed) {
      rides.value = listed.rides
      declineAlerts.value = listed.declineAlerts
    }
  }
  catch {
    if (ticket !== loadTicket)
      return
    loadError.value = true
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

function openPlace(target: 'start' | 'end') {
  placeTarget.value = target
  placeName.value = ''
  placeKind.value = undefined
  placeAddress.value = ''
  placeNameErrorKey.value = null
  placeKindErrorKey.value = null
  formErrorKey.value = null
}

async function addPlace() {
  placeNameErrorKey.value = locationNameError(placeName.value) === 'empty'
    ? 'locations.nameEmpty'
    : locationNameError(placeName.value) === 'too-long'
      ? 'locations.nameTooLong'
      : null
  placeKindErrorKey.value = locationKindError(placeKind.value ?? '') ? 'locations.kindInvalid' : null
  if (placeNameErrorKey.value || placeKindErrorKey.value || !placeTarget.value || !placeKind.value)
    return
  placePending.value = true
  formErrorKey.value = null
  try {
    const created = locationSchema.parse(await $fetch('/api/locations', {
      method: 'POST',
      body: {
        name: placeName.value,
        kind: placeKind.value,
        address: placeAddress.value,
      },
    }))
    locations.value = [...locations.value, created].sort((left, right) => left.name.localeCompare(right.name))
    if (placeTarget.value === 'start')
      startLocationId.value = created.id
    else
      endLocationId.value = created.id
    placeTarget.value = null
  }
  catch (error) {
    formErrorKey.value = failureKey(error) === 'transfers.saveFailed' ? 'locations.saveFailed' : failureKey(error)
  }
  finally {
    placePending.value = false
  }
}

function formReady(): boolean {
  guestErrorKey.value = guestNameError(guest.value) === 'empty'
    ? 'transfers.guestEmpty'
    : guestNameError(guest.value) === 'too-long'
      ? 'transfers.guestTooLong'
      : null
  tablaErrorKey.value = tablaError(tabla.value) ? 'transfers.tablaTooLong' : null
  flightErrorKey.value = flightNumberError(flight.value) ? 'transfers.flightTooLong' : null
  noteErrorKey.value = noteError(note.value) ? 'transfers.noteTooLong' : null
  priceErrorKey.value = priceError(price.value) ? 'transfers.priceInvalid' : null
  passengerErrorKey.value = passengerCountError(passengers.value) ? 'transfers.countInvalid' : null
  luggageErrorKey.value = luggageCountError(luggage.value) ? 'transfers.countInvalid' : null
  seatErrorKey.value = childSeatCountError(childSeats.value) ? 'transfers.countInvalid' : null
  pickupErrorKey.value = pickupFieldError()
  endErrorKey.value = startLocationId.value && endLocationId.value && sameLocationError(startLocationId.value, endLocationId.value)
    ? 'transfers.samePlace'
    : null
  return !guestErrorKey.value
    && !tablaErrorKey.value
    && !flightErrorKey.value
    && !noteErrorKey.value
    && !priceErrorKey.value
    && !passengerErrorKey.value
    && !luggageErrorKey.value
    && !seatErrorKey.value
    && !pickupErrorKey.value
    && !endErrorKey.value
    && !!clientId.value
    && !!startLocationId.value
    && !!endLocationId.value
    && !!payment.value
}

function pickupFieldError(): 'transfers.pickupInvalid' | 'transfers.pickupTooEarly' | 'transfers.pickupTooLate' | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(pickupWall.value))
    return 'transfers.pickupInvalid'
  let instant: Date
  try {
    instant = instantFromWallClock(pickupWall.value.slice(0, 16), props.timeZone)
  }
  catch {
    return 'transfers.pickupInvalid'
  }
  const error = pickupAtError(instant.toISOString(), new Date())
  if (error === 'invalid')
    return 'transfers.pickupInvalid'
  if (error === 'too-early')
    return 'transfers.pickupTooEarly'
  if (error === 'too-late')
    return 'transfers.pickupTooLate'
  return null
}

function priceForForm(price: string): string {
  return props.locale === 'hr' ? price.replace('.', ',') : price
}

/**
 * Locale switch leaves this page and comes back. The open slideover and the
 * typed booking stay in sessionStorage for this Tenant so that return can
 * open them again. Another Tenant's draft is dropped. This is the form on
 * this browser, not an audit entry and not a log. Restore runs in onMounted,
 * after hydration. Values stay strings until the record or correct route parses them.
 */
const DRAFT_KEY = 'transferpro-transfer-form'
let ignoreDraft = false

const transferFormDraftSchema = z.object({
  tenantId: z.uuid(),
  transferId: z.uuid().nullable(),
  clientId: z.uuid().nullable(),
  pickupWall: z.string(),
  startLocationId: z.uuid().nullable(),
  endLocationId: z.uuid().nullable(),
  passengers: z.string(),
  guest: z.string(),
  tabla: z.string(),
  flight: z.string(),
  price: z.string(),
  payment: paymentMethodSchema.nullable(),
  airportMark: z.boolean(),
  luggage: z.string(),
  childSeats: z.string(),
  note: z.string(),
  placeTarget: z.enum(['start', 'end']).nullable(),
  placeName: z.string(),
  placeKind: locationKindSchema.nullable(),
  placeAddress: z.string(),
})

type TransferFormDraft = z.infer<typeof transferFormDraftSchema>

function currentDraft(): TransferFormDraft {
  return {
    tenantId: props.tenantId,
    transferId: editingTransferId.value,
    clientId: clientId.value ?? null,
    pickupWall: pickupWall.value,
    startLocationId: startLocationId.value ?? null,
    endLocationId: endLocationId.value ?? null,
    passengers: passengers.value,
    guest: guest.value,
    tabla: tabla.value,
    flight: flight.value,
    price: price.value,
    payment: payment.value ?? null,
    airportMark: airportMark.value,
    luggage: luggage.value,
    childSeats: childSeats.value,
    note: note.value,
    placeTarget: placeTarget.value,
    placeName: placeName.value,
    placeKind: placeKind.value ?? null,
    placeAddress: placeAddress.value,
  }
}

function applyDraft(draft: TransferFormDraft) {
  editingTransferId.value = draft.transferId
  clientId.value = draft.clientId ?? undefined
  pickupWall.value = draft.pickupWall
  startLocationId.value = draft.startLocationId ?? undefined
  endLocationId.value = draft.endLocationId ?? undefined
  passengers.value = draft.passengers
  guest.value = draft.guest
  tabla.value = draft.tabla
  flight.value = draft.flight
  price.value = draft.price
  payment.value = draft.payment ?? undefined
  airportMark.value = draft.airportMark
  luggage.value = draft.luggage
  childSeats.value = draft.childSeats
  note.value = draft.note
  placeTarget.value = draft.placeTarget
  placeName.value = draft.placeName
  placeKind.value = draft.placeKind ?? undefined
  placeAddress.value = draft.placeAddress
  formMode.value = draft.transferId === null ? 'add' : 'edit'
}

function restoreDraft() {
  const raw = sessionStorage.getItem(DRAFT_KEY)
  if (raw === null)
    return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    sessionStorage.removeItem(DRAFT_KEY)
    return
  }
  const draft = transferFormDraftSchema.safeParse(parsed)
  if (!draft.success || draft.data.tenantId !== props.tenantId) {
    sessionStorage.removeItem(DRAFT_KEY)
    return
  }
  ignoreDraft = true
  applyDraft(draft.data)
  ignoreDraft = false
}

const formOpen = computed({
  get: () => formMode.value !== null,
  set(open: boolean) {
    if (!open && !pending.value)
      closeForm()
  },
})

const formTitle = computed(() => formMode.value === 'edit' ? t('transfers.correctTitle') : t('transfers.add'))

function clearFieldErrors() {
  guestErrorKey.value = null
  tablaErrorKey.value = null
  flightErrorKey.value = null
  noteErrorKey.value = null
  priceErrorKey.value = null
  passengerErrorKey.value = null
  luggageErrorKey.value = null
  seatErrorKey.value = null
  pickupErrorKey.value = null
  endErrorKey.value = null
  placeNameErrorKey.value = null
  placeKindErrorKey.value = null
}

/** Cancel and dismiss close the slideover and do not save. */
function closeForm() {
  ignoreDraft = true
  formMode.value = null
  editingTransferId.value = null
  placeTarget.value = null
  formErrorKey.value = null
  clearFieldErrors()
  sessionStorage.removeItem(DRAFT_KEY)
  ignoreDraft = false
}

function openAdd() {
  clearFieldErrors()
  formErrorKey.value = null
  editingTransferId.value = null
  clientId.value = undefined
  pickupWall.value = `${pickupDay}T12:00`
  startLocationId.value = undefined
  endLocationId.value = undefined
  passengers.value = '1'
  guest.value = ''
  tabla.value = ''
  flight.value = ''
  price.value = ''
  payment.value = undefined
  airportMark.value = false
  luggage.value = '0'
  childSeats.value = '0'
  note.value = ''
  placeTarget.value = null
  placeName.value = ''
  placeAddress.value = ''
  placeKind.value = undefined
  formMode.value = 'add'
}

/**
 * Fills the booking form from the row. The landing time stays on the board.
 * Cancel drops the values and does not save.
 */
function openCorrect(ride: TransferDayRide) {
  clearFieldErrors()
  formErrorKey.value = null
  editingTransferId.value = ride.transferId
  clientId.value = ride.clientId
  pickupWall.value = wallClockInTimeZone(props.timeZone, new Date(ride.pickupAt))
  startLocationId.value = ride.startLocationId
  endLocationId.value = ride.endLocationId
  passengers.value = String(ride.passengerCount)
  guest.value = ride.guestName
  tabla.value = ride.tabla
  flight.value = ride.flightNumber ?? ''
  price.value = priceForForm(ride.price)
  payment.value = ride.payment
  airportMark.value = ride.airportMark
  luggage.value = String(ride.luggageCount)
  childSeats.value = String(ride.childSeatCount)
  note.value = ride.note ?? ''
  placeTarget.value = null
  formMode.value = 'edit'
}

function correctActions(ride: TransferDayRide): DropdownMenuItem[][] {
  return [[
    {
      label: t('transfers.correct'),
      icon: 'i-lucide-pencil',
      onSelect: () => openCorrect(ride),
    },
  ]]
}

function bookingBody() {
  return {
    clientId: clientId.value,
    pickupAt: instantFromWallClock(pickupWall.value.slice(0, 16), props.timeZone).toISOString(),
    startLocationId: startLocationId.value,
    endLocationId: endLocationId.value,
    passengerCount: Number(passengers.value),
    guestName: guest.value,
    tabla: tabla.value,
    flightNumber: flight.value,
    price: priceFromInput(price.value),
    payment: payment.value,
    airportMark: airportMark.value,
    luggageCount: Number(luggage.value),
    childSeatCount: Number(childSeats.value),
    note: note.value,
  }
}

async function saveCorrection() {
  const transferId = editingTransferId.value
  saved.value = false
  corrected.value = false
  formErrorKey.value = null
  if (!transferId || !formReady() || !clientId.value || !startLocationId.value || !endLocationId.value || !payment.value) {
    if (!clientId.value || !startLocationId.value || !endLocationId.value || !payment.value)
      formErrorKey.value = 'transfers.rejected'
    return
  }
  pending.value = true
  try {
    recordedTransferSchema.parse(await $fetch(`/api/transfers/${transferId}`, {
      method: 'PATCH',
      body: bookingBody(),
    }))
    corrected.value = true
    closeForm()
    await loadDay()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    pending.value = false
  }
}

async function record() {
  saved.value = false
  corrected.value = false
  formErrorKey.value = null
  if (!formReady() || !clientId.value || !startLocationId.value || !endLocationId.value || !payment.value) {
    if (!clientId.value || !startLocationId.value || !endLocationId.value || !payment.value)
      formErrorKey.value = 'transfers.rejected'
    return
  }
  pending.value = true
  try {
    const recorded = recordedTransferSchema.parse(await $fetch('/api/transfers', {
      method: 'POST',
      body: bookingBody(),
    }))
    saved.value = true
    closeForm()
    day.value = operationalDateInTimeZone(props.timeZone, new Date(recorded.transfer.pickupAt), props.operationalDayStartHour)
    await loadDay()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    pending.value = false
  }
}

watch(day, () => {
  assigning.value = null
  // A different day is a different list. Close the phone dialog. That does not post.
  // The booking slideover stays open.
  acceptingByPhone.value = null
  acceptByPhoneErrorKey.value = null
  void loadDay()
})

watch(
  () => formMode.value === null ? null : currentDraft(),
  (draft) => {
    if (!import.meta.client || ignoreDraft)
      return
    if (draft === null)
      sessionStorage.removeItem(DRAFT_KEY)
    else
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  },
)

onMounted(() => {
  restoreDraft()
  void loadAll()
})
</script>

<template>
  <section>
    <UFormField
      :label="t('transfers.day')"
      name="day"
      class="mb-4"
      size="xl"
    >
      <UInput
        id="transfer-day"
        v-model="day"
        name="day"
        type="date"
        class="w-full"
      />
    </UFormField>

    <UButton
      type="button"
      size="xl"
      icon="i-lucide-plus"
      class="mb-4"
      @click="openAdd"
    >
      {{ t('transfers.add') }}
    </UButton>
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
    <p
      v-if="loading"
      role="status"
    >
      {{ t('transfers.loading') }}
    </p>
    <p v-else-if="!loadError && rides.length === 0">
      {{ t('transfers.empty') }}
    </p>
    <div
      v-else-if="!loadError"
      ref="dayListRegion"
      class="overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      role="region"
      :aria-label="t('transfers.title')"
      tabindex="0"
    >
      <UTable
        :data="rides"
        :columns="columns"
        class="whitespace-nowrap"
      >
        <template #pickup-cell="{ row }">
          <time :datetime="row.original.pickupAt">
            {{ formatInstant(new Date(row.original.pickupAt), timeZone, locale) }}
          </time>
        </template>
        <template #landing-cell="{ row }">
          <time
            v-if="row.original.landingAt"
            :datetime="row.original.landingAt"
          >
            {{ formatInstant(new Date(row.original.landingAt), timeZone, locale) }}
          </time>
        </template>
        <template #expectedArrival-cell="{ row }">
          <time
            v-if="row.original.expectedArrival"
            :datetime="row.original.expectedArrival"
          >
            {{ formatInstant(new Date(row.original.expectedArrival), timeZone, locale) }}
          </time>
        </template>
        <template #tabla-cell="{ row }">
          <span v-if="row.original.tabla">{{ row.original.tabla }}</span>
        </template>
        <template #start-cell="{ row }">
          {{ placeLabel(row.original.startLocationId) }}
        </template>
        <template #end-cell="{ row }">
          {{ placeLabel(row.original.endLocationId) }}
        </template>
        <template #state-cell="{ row }">
          <span>{{ t(`transfers.states.${row.original.state}`) }}</span>
          <!--
            Text, not color. The alarm does not hide the row actions.
          -->
          <p
            v-if="row.original.landingAlarm"
            class="mt-1 whitespace-normal"
          >
            {{ t('officeHome.landingAlarm') }}
          </p>
        </template>
        <template #driver-cell="{ row }">
          {{ driverLabel(row.original.driverId) }}
        </template>
        <template #vehicle-cell="{ row }">
          <span>
            {{ vehicleLabel(row.original.vehicleId) }}
            <UBadge
              v-if="vehicleArchived(row.original.vehicleId)"
              color="neutral"
              variant="subtle"
              class="ml-2"
            >
              {{ t('vehicles.archived') }}
            </UBadge>
          </span>
        </template>
        <template #actions-header>
          <span class="sr-only">{{ t('ride.actions') }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex flex-wrap gap-2">
            <!--
              Correct is the only menu item. A finished Ride has no trigger.
              Assign and the other ride commands stay buttons beside it.
            -->
            <UDropdownMenu
              v-if="canCorrectTransfer(row.original.state)"
              :items="correctActions(row.original)"
              size="xl"
            >
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                size="xl"
                icon="i-lucide-ellipsis-vertical"
                :aria-label="t('transfers.actionsFor', { guest: row.original.guestName })"
              />
            </UDropdownMenu>
            <UButton
              v-if="canRecordLandingTime(row.original.state)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.recordLandingFor', { guest: row.original.guestName })"
              @click="openLanding(row.original)"
            >
              {{ t('ride.recordLanding') }}
            </UButton>
            <UButton
              v-if="row.original.state === 'unassigned'"
              :id="assignButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.assignFor', { guest: row.original.guestName })"
              @click="openAssign(row.original)"
            >
              {{ t('ride.assign') }}
            </UButton>
            <!--
              Assigned and the copied flag, both. Accepted still has the flag
              and does not offer this. There is no note on the dialog.
            -->
            <UButton
              v-if="canRecordAcceptanceByPhone(row.original)"
              :id="acceptByPhoneButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.acceptByPhoneFor', { guest: row.original.guestName })"
              @click="openAcceptByPhone(row.original)"
            >
              {{ t('ride.acceptByPhone') }}
            </UButton>
            <UButton
              v-if="canCallOff(row.original)"
              :id="cancelRideButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.cancelRideFor', { guest: row.original.guestName })"
              @click="openCancelRide(row.original)"
            >
              {{ t('ride.cancelRide') }}
            </UButton>
            <UButton
              v-if="canFinish(row.original)"
              :id="markDoneButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.markDoneFor', { guest: row.original.guestName })"
              @click="openMarkDone(row.original)"
            >
              {{ t('ride.markDone') }}
            </UButton>
            <UButton
              v-if="canNoShow(row.original)"
              :id="markNoShowButtonId(row.original.rideId)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="t('ride.markNoShowFor', { guest: row.original.guestName })"
              @click="openMarkNoShow(row.original)"
            >
              {{ t('ride.markNoShow') }}
            </UButton>
            <template v-if="canChangeAssignment(row.original)">
              <UButton
                :id="`change-vehicle-${row.original.rideId}`"
                type="button"
                color="neutral"
                variant="outline"
                size="xl"
                :aria-label="t('ride.changeVehicleFor', { guest: row.original.guestName })"
                @click="openVehicleChange(row.original)"
              >
                {{ t('ride.changeVehicle') }}
              </UButton>
              <UButton
                :id="`reassign-ride-${row.original.rideId}`"
                type="button"
                color="neutral"
                variant="outline"
                size="xl"
                :aria-label="t('ride.reassignFor', { guest: row.original.guestName })"
                @click="openReassign(row.original)"
              >
                {{ t('ride.reassign') }}
              </UButton>
              <UButton
                :id="`clear-ride-${row.original.rideId}`"
                type="button"
                color="neutral"
                variant="outline"
                size="xl"
                :aria-label="t('ride.clearFor', { guest: row.original.guestName })"
                @click="openClear(row.original)"
              >
                {{ t('ride.clear') }}
              </UButton>
            </template>
          </div>
        </template>
      </UTable>
    </div>

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

    <UModal
      v-model:open="clearOpen"
      :title="t('ride.clearTitle')"
      :description="t('ride.clearBody')"
      :dismissible="!clearPending"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p v-if="clearing">
          {{ clearing.guestName }}
        </p>
        <UAlert
          v-if="clearErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mt-4"
          :description="t(clearErrorKey)"
        />
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="clearPending"
          @click="closeClear"
        >
          {{ t('ride.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="clearPending"
          :disabled="clearPending"
          @click="confirmClear"
        >
          {{ clearPending ? t('ride.clearing') : t('ride.clearConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="acceptByPhoneOpen"
      :title="t('ride.acceptByPhoneTitle')"
      :description="t('ride.acceptByPhoneBody')"
      :dismissible="!acceptByPhonePending"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p v-if="acceptingByPhone">
          {{ acceptingByPhone.guestName }}
        </p>
        <UAlert
          v-if="acceptByPhoneErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mt-4"
          :description="t(acceptByPhoneErrorKey)"
        />
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="acceptByPhonePending"
          @click="closeAcceptByPhone"
        >
          {{ t('ride.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="acceptByPhonePending"
          :disabled="acceptByPhonePending"
          @click="confirmAcceptByPhone"
        >
          {{ acceptByPhonePending ? t('ride.acceptByPhoneConfirming') : t('ride.acceptByPhoneConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="markDoneOpen"
      :title="t('ride.markDoneTitle')"
      :description="t('ride.markDoneBody')"
      :dismissible="!markDonePending"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p v-if="markingDone">
          {{ markingDone.guestName }}
        </p>
        <UAlert
          v-if="markDoneErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mt-4"
          :description="t(markDoneErrorKey)"
        />
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="markDonePending"
          @click="closeMarkDone"
        >
          {{ t('ride.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="markDonePending"
          :disabled="markDonePending"
          @click="confirmMarkDone"
        >
          {{ markDonePending ? t('ride.markDoneConfirming') : t('ride.markDoneConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="markNoShowOpen"
      :title="t('ride.markNoShowTitle')"
      :description="t('ride.markNoShowBody')"
      :dismissible="!markNoShowPending"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p v-if="markingNoShow">
          {{ markingNoShow.guestName }}
        </p>
        <UAlert
          v-if="markNoShowErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mt-4"
          :description="t(markNoShowErrorKey)"
        />
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="markNoShowPending"
          @click="closeMarkNoShow"
        >
          {{ t('ride.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="markNoShowPending"
          :disabled="markNoShowPending"
          @click="confirmMarkNoShow"
        >
          {{ markNoShowPending ? t('ride.markNoShowConfirming') : t('ride.markNoShowConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="cancelRideOpen"
      :title="t('ride.cancelRideTitle')"
      :description="t('ride.cancelRideBody')"
      :dismissible="!cancelPending"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p v-if="cancelling">
          {{ cancelling.guestName }}
        </p>
        <UAlert
          v-if="cancelErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mt-4"
          :description="t(cancelErrorKey)"
        />
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="cancelPending"
          @click="closeCancelRide"
        >
          {{ t('ride.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="cancelPending"
          :disabled="cancelPending"
          @click="confirmCancelRide"
        >
          {{ cancelPending ? t('ride.cancelRideConfirming') : t('ride.cancelRideConfirm') }}
        </UButton>
      </template>
    </UModal>

    <USlideover
      v-model:open="formOpen"
      :title="formTitle"
      :dismissible="!pending && !placePending"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p
          v-if="pending || placePending"
          role="status"
          class="sr-only"
        >
          {{
            placePending
              ? t('transfers.addPlace')
              : formMode === 'edit'
                ? t('transfers.savingCorrection')
                : t('transfers.submitting')
          }}
        </p>
        <UAlert
          v-if="formErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mb-4"
          :description="t(formErrorKey)"
        />

        <form
          v-if="placeTarget"
          class="mb-6"
          @submit.prevent="addPlace"
        >
          <h3 class="mb-4 text-lg font-semibold">
            {{ placeTarget === 'start' ? t('transfers.placeForStart') : t('transfers.placeForEnd') }}
          </h3>
          <UFormField
            :label="t('locations.name')"
            name="place-name"
            class="mb-4"
            size="xl"
            :error="placeNameErrorKey ? t(placeNameErrorKey) : false"
          >
            <UInput
              id="place-name"
              v-model="placeName"
              name="place-name"
              type="text"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('locations.kind')"
            name="place-kind"
            class="mb-4"
            size="xl"
            :error="placeKindErrorKey ? t(placeKindErrorKey) : false"
          >
            <USelect
              id="place-kind"
              v-model="placeKind"
              name="place-kind"
              :items="kindItems"
              :placeholder="t('locations.chooseKind')"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('locations.address')"
            name="place-address"
            class="mb-4"
            size="xl"
          >
            <UInput
              id="place-address"
              v-model="placeAddress"
              name="place-address"
              type="text"
              autocomplete="off"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="submit"
            size="xl"
            :loading="placePending"
          >
            {{ t('transfers.addPlace') }}
          </UButton>
        </form>

        <form
          id="transfer-form"
          @submit.prevent="formMode === 'edit' ? saveCorrection() : record()"
        >
          <UFormField
            :label="t('transfers.client')"
            name="client"
            class="mb-4"
            size="xl"
          >
            <USelect
              id="transfer-client"
              v-model="clientId"
              name="client"
              :items="clientItems"
              :placeholder="t('transfers.chooseClient')"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="t('transfers.pickupAt')"
            name="pickup"
            class="mb-4"
            size="xl"
            :error="pickupErrorKey ? t(pickupErrorKey) : false"
          >
            <UInput
              id="transfer-pickup"
              v-model="pickupWall"
              name="pickup"
              type="datetime-local"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.start')"
            name="start"
            class="mb-4"
            size="xl"
          >
            <USelect
              id="transfer-start"
              v-model="startLocationId"
              name="start"
              :items="locationItems"
              :placeholder="t('transfers.chooseLocation')"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            class="mb-4"
            @click="openPlace('start')"
          >
            {{ t('transfers.placeForStart') }}
          </UButton>
          <UFormField
            :label="t('transfers.end')"
            name="end"
            class="mb-4"
            size="xl"
            :error="endErrorKey ? t(endErrorKey) : false"
          >
            <USelect
              id="transfer-end"
              v-model="endLocationId"
              name="end"
              :items="locationItems"
              :placeholder="t('transfers.chooseLocation')"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            class="mb-4"
            @click="openPlace('end')"
          >
            {{ t('transfers.placeForEnd') }}
          </UButton>
          <UFormField
            :label="t('transfers.passengers')"
            name="passengers"
            class="mb-4"
            size="xl"
            :error="passengerErrorKey ? t(passengerErrorKey) : false"
          >
            <UInput
              id="transfer-passengers"
              v-model="passengers"
              name="passengers"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.guest')"
            name="guest"
            class="mb-4"
            size="xl"
            :error="guestErrorKey ? t(guestErrorKey) : false"
          >
            <UInput
              id="transfer-guest"
              v-model="guest"
              name="guest"
              type="text"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.tabla')"
            name="tabla"
            class="mb-4"
            size="xl"
            :error="tablaErrorKey ? t(tablaErrorKey) : false"
          >
            <UInput
              id="transfer-tabla"
              v-model="tabla"
              name="tabla"
              type="text"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.flight')"
            name="flight"
            class="mb-4"
            size="xl"
            :error="flightErrorKey ? t(flightErrorKey) : false"
          >
            <UInput
              id="transfer-flight"
              v-model="flight"
              name="flight"
              type="text"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.price')"
            name="price"
            class="mb-4"
            size="xl"
            :error="priceErrorKey ? t(priceErrorKey) : false"
          >
            <UInput
              id="transfer-price"
              v-model="price"
              name="price"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.payment')"
            name="payment"
            class="mb-4"
            size="xl"
          >
            <USelect
              id="transfer-payment"
              v-model="payment"
              name="payment"
              :items="paymentItems"
              :placeholder="t('transfers.choosePayment')"
              class="w-full"
            />
          </UFormField>
          <UCheckbox
            id="transfer-airport"
            v-model="airportMark"
            name="airport"
            size="xl"
            class="mb-4"
            :label="t('transfers.airport')"
          />
          <UFormField
            :label="t('transfers.luggage')"
            name="luggage"
            class="mb-4"
            size="xl"
            :error="luggageErrorKey ? t(luggageErrorKey) : false"
          >
            <UInput
              id="transfer-luggage"
              v-model="luggage"
              name="luggage"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.childSeats')"
            name="child-seats"
            class="mb-4"
            size="xl"
            :error="seatErrorKey ? t(seatErrorKey) : false"
          >
            <UInput
              id="transfer-seats"
              v-model="childSeats"
              name="child-seats"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('transfers.note')"
            name="note"
            class="mb-4"
            size="xl"
            :error="noteErrorKey ? t(noteErrorKey) : false"
          >
            <UTextarea
              id="transfer-note"
              v-model="note"
              name="note"
              :rows="3"
              class="w-full"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
        </form>
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="pending"
          @click="formOpen = false"
        >
          {{ t('transfers.cancelCorrect') }}
        </UButton>
        <UButton
          type="submit"
          form="transfer-form"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="pending"
        >
          {{
            formMode === 'edit'
              ? (pending ? t('transfers.savingCorrection') : t('transfers.saveCorrection'))
              : (pending ? t('transfers.submitting') : t('transfers.submit'))
          }}
        </UButton>
      </template>
    </USlideover>
  </section>
</template>
