import type { Client, DisplayLocale, Driver, Location, LocationKind, PaymentMethod, TransferDayRide } from '../../shared'
import { z } from 'zod'
import { calendarDateInTimeZone, childSeatCountError, correctedTransferResultSchema, flightNumberError, guestNameError, instantFromWallClock, locationKindError, locationKindSchema, locationNameError, locationSchema, luggageCountError, noteError, operationalDateInTimeZone, passengerCountError, paymentMethodSchema, pickupAtError, priceError, priceFromInput, recordedTransferSchema, sameLocationError, tablaError, wallClockInTimeZone } from '../../shared'
import { errorCode, httpStatus } from '../transfer-day-http'
import { driverDisplayName } from '../transfer-day-labels'
import { workOrderNotice } from '../work-order-notice'

type TransferFailure
  = 'transfers.rejected'
    | 'transfers.notFound'
    | 'transfers.forbidden'
    | 'transfers.signedOut'
    | 'transfers.saveFailed'
    | 'transfers.locationArchived'
    | 'transfers.closed'
    | 'locations.saveFailed'

/**
 * Locale switch leaves this page and comes back. The open slideover and the
 * typed booking stay in sessionStorage for this Tenant so that return can
 * open them again. Another Tenant's draft is dropped. This is the form on
 * this browser, not an audit entry and not a log. Restore runs in onMounted,
 * after hydration. Values stay strings until the record or correct route parses them.
 */
const DRAFT_KEY = 'transferpro-transfer-form'

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

/**
 * Add and correct share one slideover. The day board only opens it.
 * Catalogs and the day ref stay with the board so a save reloads the same list.
 */
export function useTransferForm(options: {
  timeZone: () => string
  locale: () => DisplayLocale
  operationalDayStartHour: () => number
  tenantId: () => string
  clients: () => readonly Client[]
  drivers: () => readonly Driver[]
  locations: Ref<Location[]>
  day: Ref<string>
  loadDay: () => Promise<void>
  saved: Ref<boolean>
  corrected: Ref<boolean>
}) {
  const { t } = useI18n()
  const toast = useToast()
  const { notifyAuditChanged } = useAuditRefresh()

  // A pickup form still defaults to noon on the calendar date: recording a pickup did not move.
  const pickupDay = calendarDateInTimeZone(options.timeZone(), new Date())

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

  const pending = ref(false)
  const placePending = ref(false)
  // A true overlap keeps the slideover. Confirm re-sends the same booking.
  const overlapOpen = ref(false)
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

  let ignoreDraft = false

  const clientItems = computed(() => options.clients().map(client => ({
    label: client.name,
    value: client.id,
  })))

  const locationItems = computed(() => options.locations.value
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

  function driverLabel(id: string | null): string {
    return driverDisplayName(options.drivers(), id, t('ride.unknownDriver'))
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
      options.locations.value = [...options.locations.value, created].sort((left, right) => left.name.localeCompare(right.name))
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
      instant = instantFromWallClock(pickupWall.value.slice(0, 16), options.timeZone())
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

  function priceForForm(amount: string): string {
    return options.locale() === 'hr' ? amount.replace('.', ',') : amount
  }

  function currentDraft(): TransferFormDraft {
    return {
      tenantId: options.tenantId(),
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
    if (!draft.success || draft.data.tenantId !== options.tenantId()) {
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
    overlapOpen.value = false
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

  // The frame's Novi transfer button increments this. Opening Transfers
  // from another screen still finds the request, because the watch is immediate.
  const { nonce: newTransferNonce } = useNewTransferRequest()
  watch(newTransferNonce, (value) => {
    if (value === 0)
      return
    newTransferNonce.value = 0
    openAdd()
  }, { immediate: true })

  /**
   * Fills the booking form from the row. The landing time stays on the board.
   * Cancel drops the values and does not save.
   */
  function openCorrect(ride: TransferDayRide) {
    clearFieldErrors()
    formErrorKey.value = null
    overlapOpen.value = false
    editingTransferId.value = ride.transferId
    clientId.value = ride.clientId
    pickupWall.value = wallClockInTimeZone(options.timeZone(), new Date(ride.pickupAt))
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

  function bookingBody() {
    return {
      clientId: clientId.value,
      pickupAt: instantFromWallClock(pickupWall.value.slice(0, 16), options.timeZone()).toISOString(),
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

  async function saveCorrection(confirm = false) {
    const transferId = editingTransferId.value
    options.saved.value = false
    options.corrected.value = false
    formErrorKey.value = null
    if (!transferId || !formReady() || !clientId.value || !startLocationId.value || !endLocationId.value || !payment.value) {
      if (!clientId.value || !startLocationId.value || !endLocationId.value || !payment.value)
        formErrorKey.value = 'transfers.rejected'
      return
    }
    pending.value = true
    try {
      const correction = correctedTransferResultSchema.parse(await $fetch(`/api/transfers/${transferId}`, {
        method: 'PATCH',
        body: {
          ...bookingBody(),
          ...(confirm ? { confirm: true } : {}),
        },
      }))
      overlapOpen.value = false
      options.corrected.value = true
      notifyAuditChanged()
      if (correction.relocationWarnings.length > 0) {
        toast.add({
          title: t('ride.tightGap'),
          color: 'warning',
        })
      }
      // The notice names the Driver by id. The name is already on the day list.
      // A Ride with no Driver has no notice. The response has no address.
      for (const notice of correction.workOrders) {
        const shown = workOrderNotice(notice.outcome)
        toast.add({
          title: t('transfers.corrected'),
          description: t(shown.key, { name: driverLabel(notice.driverId) }),
          color: shown.color,
        })
      }
      closeForm()
      await options.loadDay()
    }
    catch (error) {
      if (errorCode(error) === 'ride_overlap') {
        overlapOpen.value = true
        return
      }
      overlapOpen.value = false
      formErrorKey.value = failureKey(error)
    }
    finally {
      pending.value = false
    }
  }

  async function record() {
    options.saved.value = false
    options.corrected.value = false
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
      options.saved.value = true
      closeForm()
      options.day.value = operationalDateInTimeZone(options.timeZone(), new Date(recorded.transfer.pickupAt), options.operationalDayStartHour())
      await options.loadDay()
    }
    catch (error) {
      formErrorKey.value = failureKey(error)
    }
    finally {
      pending.value = false
    }
  }

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
  })

  return {
    clientId,
    pickupWall,
    startLocationId,
    endLocationId,
    passengers,
    guest,
    tabla,
    flight,
    price,
    payment,
    airportMark,
    luggage,
    childSeats,
    note,
    placeTarget,
    placeName,
    placeKind,
    placeAddress,
    pending,
    placePending,
    overlapOpen,
    formMode,
    formErrorKey,
    guestErrorKey,
    tablaErrorKey,
    flightErrorKey,
    noteErrorKey,
    priceErrorKey,
    passengerErrorKey,
    luggageErrorKey,
    seatErrorKey,
    pickupErrorKey,
    endErrorKey,
    placeNameErrorKey,
    placeKindErrorKey,
    clientItems,
    locationItems,
    paymentItems,
    kindItems,
    formOpen,
    formTitle,
    openPlace,
    addPlace,
    openAdd,
    openCorrect,
    saveCorrection,
    record,
  }
}
