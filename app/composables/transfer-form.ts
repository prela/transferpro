import type { InjectionKey } from 'vue'
import type { CapacityDialogReason, Client, ClientKind, DisplayLocale, Driver, Location, LocationKind, LocationPlace, PaymentMethod, RecordedCreate, TransferDayRide, TransferDraftFields, TransferPrefill } from '../../shared'
import { z } from 'zod'
import { applyTransferDraftEvent, calendarDateInTimeZone, capacityDialogReason, childSeatCountError, clientKindError, clientNameError, clientReferenceError, clientSchema, correctedTransferResultSchema, flightNumberError, guestNameError, instantFromWallClock, locationKindError, locationLabel, locationNameError, locationSchema, luggageCountError, noteError, operationalDateInTimeZone, passengerCountError, pickupAtError, priceError, priceFromInput, recallTransferDraft, recordedCreateSchema, rememberTransferDraft, sameLocationError, tablaError, transferEntryKey, wallClockInTimeZone } from '../../shared'
import { useWorkOrderPresenter } from '../composables/kept-work-orders'
import { errorCode, httpStatus } from '../transfer-day-http'
import { driverDisplayName } from '../transfer-day-labels'

type TransferFailure
  = 'transfers.rejected'
    | 'transfers.notFound'
    | 'transfers.forbidden'
    | 'transfers.signedOut'
    | 'transfers.saveFailed'
    | 'transfers.locationArchived'
    | 'transfers.closed'
    | 'locations.saveFailed'
    | 'clients.saveFailed'

/**
 * An unfinished new Transfer stays in localStorage, keyed by user and Tenant
 * (ADR-0038). A locale switch leaves this page and comes back; the draft is
 * how the typed booking returns. The entry key travels with that draft and
 * is the only part sent on create (ADR-0035). A correction is not a draft
 * and has no key. The previous sessionStorage key is retired on restore.
 * Values stay strings until the record or correct route parses them.
 */
const LEGACY_DRAFT_KEY = 'transferpro-transfer-form'

/**
 * Add and correct share the field state. The day board opens a new Transfer
 * in the same panel as the Ride detail. Catalogs and the day ref stay with
 * the board so a save reloads the same list.
 */
export const transferFormKey: InjectionKey<ReturnType<typeof useTransferForm>> = Symbol('transferForm')

export function useTransferForm(options: {
  timeZone: () => string
  locale: () => DisplayLocale
  operationalDayStartHour: () => number
  tenantId: () => string
  userId: () => string
  /** The new-Transfer panel keeps a browser draft. A correction does not. */
  persistDraft: boolean
  clients: () => readonly Client[]
  drivers: () => readonly Driver[]
  locations: Ref<Location[]>
  day: Ref<string>
  loadDay: () => Promise<void>
  saved: Ref<boolean>
  corrected: Ref<boolean>
  onClient?: (client: Client) => void
  onRecorded?: (rideId: string) => void
  onClose?: () => void
  /** 409 stale_save. The form keeps what was typed. The caller reloads who and when. */
  onStale?: () => Promise<void>
}) {
  const { t } = useI18n()
  const toast = useToast()
  const { present } = useWorkOrderPresenter()
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
  const clientReference = ref('')
  const flight = ref('')
  const price = ref('')
  const payment = ref<PaymentMethod | undefined>()
  const airportMark = ref(false)
  const luggage = ref('0')
  const childSeats = ref('0')
  const note = ref('')
  // The manual entry key. Null on a correction. A new form keeps one id for
  // the whole entry, including a reload and a retry after a lost answer.
  const entryKey = ref<string | null>(null)
  // Set when the server says this key is already stored. The draft stays
  // until the Dispatcher confirms the notice.
  const alreadySaved = ref(false)
  let heldCreate: RecordedCreate | null = null

  const placeTarget = ref<'start' | 'end' | null>(null)
  const placeName = ref('')
  const placeKind = ref<LocationKind | undefined>()
  const placeAddress = ref('')
  const heldPlace = ref<LocationPlace | null>(null)
  const clientTarget = ref(false)
  const clientName = ref('')
  const clientKind = ref<ClientKind | undefined>()

  const pending = ref(false)
  const placePending = ref(false)
  // A true overlap or an unavailability window keeps the slideover. Confirm re-sends the same booking.
  const overlapOpen = ref(false)
  const confirmReason = ref<CapacityDialogReason>('overlap')
  /**
   * Add and correct share one slideover. Null is closed.
   * `edit` patches the Transfer in `editingTransferId`.
   */
  const formMode = ref<'add' | 'edit' | null>(null)
  const editingTransferId = ref<string | null>(null)
  const editingRideId = ref<string | null>(null)
  // The version the correction was opened with. A refresh must not replace it.
  const editingVersion = ref<number | null>(null)
  const formErrorKey = ref<TransferFailure | null>(null)
  const guestErrorKey = ref<'transfers.guestEmpty' | 'transfers.guestTooLong' | null>(null)
  const tablaErrorKey = ref<'transfers.tablaTooLong' | null>(null)
  const clientReferenceErrorKey = ref<'transfers.clientReferenceTooLong' | null>(null)
  const flightErrorKey = ref<'transfers.flightTooLong' | null>(null)
  const noteErrorKey = ref<'transfers.noteTooLong' | null>(null)
  const priceErrorKey = ref<'transfers.priceInvalid' | null>(null)
  const passengerErrorKey = ref<'transfers.countInvalid' | null>(null)
  const luggageErrorKey = ref<'transfers.countInvalid' | null>(null)
  const seatErrorKey = ref<'transfers.countInvalid' | null>(null)
  const pickupErrorKey = ref<'transfers.pickupInvalid' | 'transfers.pickupTooEarly' | 'transfers.pickupTooLate' | null>(null)
  const endErrorKey = ref<'transfers.samePlace' | 'transfers.endMissing' | null>(null)
  const clientErrorKey = ref<'transfers.clientMissing' | null>(null)
  const startErrorKey = ref<'transfers.startMissing' | null>(null)
  const paymentErrorKey = ref<'transfers.paymentMissing' | null>(null)
  const placeNameErrorKey = ref<'locations.nameEmpty' | 'locations.nameTooLong' | null>(null)
  const placeKindErrorKey = ref<'locations.kindInvalid' | null>(null)
  const clientNameErrorKey = ref<'clients.nameEmpty' | 'clients.nameTooLong' | null>(null)
  const clientKindErrorKey = ref<'clients.kindInvalid' | null>(null)
  /** Bumped when a submit fails so the summary can take focus. */
  const validationNonce = ref(0)
  /**
   * Bumped when a duplicate or a return fills the form. Više opens from
   * this, because the mode is already `add` and would not change again.
   */
  const moreOpenNonce = ref(0)
  const restored = ref(false)

  let ignoreDraft = false

  const clientItems = computed(() => options.clients().map(client => ({
    label: client.name,
    value: client.id,
  })))

  const locationItems = computed(() => options.locations.value
    .filter(location => location.archivedAt === null)
    .map(location => ({ label: locationLabel(location), value: location.id })))

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

  const clientKindItems = computed(() => [
    { label: t('clients.kinds.agency'), value: 'agency' as const },
    { label: t('clients.kinds.hotel'), value: 'hotel' as const },
    { label: t('clients.kinds.individual'), value: 'individual' as const },
  ])

  // Popunjeno warns and the save still stands (ADR-0034). The board shows the same word on the Ride.
  function warnIfFullyBooked(fullyBooked: boolean) {
    if (!fullyBooked)
      return
    toast.add({
      title: t('ride.fullyBookedTitle'),
      description: t('transfers.attentionDetail.fullyBooked'),
      color: 'warning',
    })
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

  function driverLabel(id: string | null): string {
    return driverDisplayName(options.drivers(), id, t('ride.unknownDriver'))
  }

  function openPlace(target: 'start' | 'end', name = '') {
    clientTarget.value = false
    placeTarget.value = target
    placeName.value = name
    placeKind.value = undefined
    placeAddress.value = ''
    heldPlace.value = null
    placeNameErrorKey.value = null
    placeKindErrorKey.value = null
    formErrorKey.value = null
  }

  function openClient(name = '') {
    placeTarget.value = null
    clientTarget.value = true
    clientName.value = name
    clientKind.value = undefined
    clientNameErrorKey.value = null
    clientKindErrorKey.value = null
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
          // A picked suggestion keeps its place reference. Typed text does not.
          place: heldPlace.value,
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

  async function addClient() {
    clientNameErrorKey.value = clientNameError(clientName.value) === 'empty'
      ? 'clients.nameEmpty'
      : clientNameError(clientName.value) === 'too-long'
        ? 'clients.nameTooLong'
        : null
    clientKindErrorKey.value = clientKindError(clientKind.value ?? '') ? 'clients.kindInvalid' : null
    if (clientNameErrorKey.value || clientKindErrorKey.value || !clientKind.value)
      return
    placePending.value = true
    formErrorKey.value = null
    try {
      const created = clientSchema.parse(await $fetch('/api/clients', {
        method: 'POST',
        body: { name: clientName.value, kind: clientKind.value },
      }))
      options.onClient?.(created)
      clientId.value = created.id
      clientTarget.value = false
    }
    catch (error) {
      formErrorKey.value = failureKey(error) === 'transfers.saveFailed' ? 'clients.saveFailed' : failureKey(error)
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
    clientReferenceErrorKey.value = clientReferenceError(clientReference.value) ? 'transfers.clientReferenceTooLong' : null
    flightErrorKey.value = flightNumberError(flight.value) ? 'transfers.flightTooLong' : null
    noteErrorKey.value = noteError(note.value) ? 'transfers.noteTooLong' : null
    priceErrorKey.value = priceError(price.value) ? 'transfers.priceInvalid' : null
    passengerErrorKey.value = passengerCountError(passengers.value) ? 'transfers.countInvalid' : null
    luggageErrorKey.value = luggageCountError(luggage.value) ? 'transfers.countInvalid' : null
    seatErrorKey.value = childSeatCountError(childSeats.value) ? 'transfers.countInvalid' : null
    pickupErrorKey.value = pickupFieldError()
    clientErrorKey.value = clientId.value ? null : 'transfers.clientMissing'
    startErrorKey.value = startLocationId.value ? null : 'transfers.startMissing'
    endErrorKey.value = !endLocationId.value
      ? 'transfers.endMissing'
      : startLocationId.value && sameLocationError(startLocationId.value, endLocationId.value)
        ? 'transfers.samePlace'
        : null
    paymentErrorKey.value = payment.value ? null : 'transfers.paymentMissing'
    return !guestErrorKey.value
      && !tablaErrorKey.value
      && !clientReferenceErrorKey.value
      && !flightErrorKey.value
      && !noteErrorKey.value
      && !priceErrorKey.value
      && !passengerErrorKey.value
      && !luggageErrorKey.value
      && !seatErrorKey.value
      && !pickupErrorKey.value
      && !endErrorKey.value
      && !clientErrorKey.value
      && !startErrorKey.value
      && !paymentErrorKey.value
  }

  function markInvalid() {
    validationNonce.value += 1
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

  function idOrNull(value: string | undefined): string | null {
    return value !== undefined && z.uuid().safeParse(value).success ? value : null
  }

  function currentDraft(): TransferDraftFields {
    return {
      clientId: idOrNull(clientId.value),
      pickupWall: pickupWall.value,
      startLocationId: idOrNull(startLocationId.value),
      endLocationId: idOrNull(endLocationId.value),
      passengers: passengers.value,
      guest: guest.value,
      price: price.value,
      payment: payment.value ?? null,
      flight: flight.value,
      airportMark: airportMark.value,
      tabla: tabla.value,
      clientReference: clientReference.value,
      luggage: luggage.value,
      childSeats: childSeats.value,
      note: note.value,
      // Omit a missing key. An explicit undefined fails the draft schema's optional uuid.
      ...(entryKey.value ? { externalId: entryKey.value } : {}),
    }
  }

  function applyDraft(draft: TransferDraftFields) {
    clientId.value = draft.clientId ?? undefined
    pickupWall.value = draft.pickupWall
    startLocationId.value = draft.startLocationId ?? undefined
    endLocationId.value = draft.endLocationId ?? undefined
    passengers.value = draft.passengers
    guest.value = draft.guest
    tabla.value = draft.tabla
    clientReference.value = draft.clientReference
    flight.value = draft.flight
    price.value = draft.price
    payment.value = draft.payment ?? undefined
    airportMark.value = draft.airportMark
    luggage.value = draft.luggage
    childSeats.value = draft.childSeats
    note.value = draft.note
    if (draft.externalId)
      entryKey.value = draft.externalId
    formMode.value = 'add'
  }

  function restoreDraft() {
    if (!import.meta.client || !options.persistDraft)
      return
    sessionStorage.removeItem(LEGACY_DRAFT_KEY)
    const draft = recallTransferDraft(localStorage, options.userId(), options.tenantId(), new Date())
    if (!draft)
      return
    ignoreDraft = true
    applyDraft(draft)
    // A draft from before the form kept a key still has to send one.
    if (!entryKey.value)
      entryKey.value = transferEntryKey('blank')
    restored.value = true
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
    clientReferenceErrorKey.value = null
    flightErrorKey.value = null
    noteErrorKey.value = null
    priceErrorKey.value = null
    passengerErrorKey.value = null
    luggageErrorKey.value = null
    seatErrorKey.value = null
    pickupErrorKey.value = null
    endErrorKey.value = null
    clientErrorKey.value = null
    startErrorKey.value = null
    paymentErrorKey.value = null
    placeNameErrorKey.value = null
    placeKindErrorKey.value = null
    clientNameErrorKey.value = null
    clientKindErrorKey.value = null
  }

  /**
   * Cancel closes the panel and keeps an unfinished new Transfer.
   * Discard removes it. A correction has nothing stored to remove.
   */
  function closeForm(event: 'edit' | 'discard' = 'edit') {
    ignoreDraft = true
    if (options.persistDraft && import.meta.client)
      applyTransferDraftEvent(localStorage, options.userId(), options.tenantId(), event)
    formMode.value = null
    editingTransferId.value = null
    editingRideId.value = null
    editingVersion.value = null
    placeTarget.value = null
    clientTarget.value = false
    formErrorKey.value = null
    overlapOpen.value = false
    restored.value = false
    alreadySaved.value = false
    heldCreate = null
    clearFieldErrors()
    ignoreDraft = false
    options.onClose?.()
  }

  function discardDraft() {
    closeForm('discard')
  }

  function openAdd() {
    clearFieldErrors()
    formErrorKey.value = null
    alreadySaved.value = false
    heldCreate = null
    // Recall before the fields are cleared. A blank write would drop the draft.
    if (options.persistDraft && import.meta.client) {
      const draft = recallTransferDraft(localStorage, options.userId(), options.tenantId(), new Date())
      if (draft) {
        ignoreDraft = true
        applyDraft(draft)
        if (!entryKey.value)
          entryKey.value = transferEntryKey('blank')
        restored.value = true
        ignoreDraft = false
        return
      }
    }
    entryKey.value = transferEntryKey('blank')
    ignoreDraft = true
    editingTransferId.value = null
    editingVersion.value = null
    clientId.value = undefined
    pickupWall.value = `${pickupDay}T12:00`
    startLocationId.value = undefined
    endLocationId.value = undefined
    passengers.value = '1'
    guest.value = ''
    tabla.value = ''
    clientReference.value = ''
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
    heldPlace.value = null
    clientTarget.value = false
    clientName.value = ''
    clientKind.value = undefined
    restored.value = false
    formMode.value = 'add'
    ignoreDraft = false
  }

  /**
   * A duplicate or a return journey. The fields are already decided; this
   * only shows them. No Transfer is written. A draft of the new form is
   * the same browser draft as any other unfinished entry.
   */
  function openPrefill(fields: TransferPrefill, opening: 'duplicate' | 'return') {
    clearFieldErrors()
    formErrorKey.value = null
    overlapOpen.value = false
    alreadySaved.value = false
    heldCreate = null
    ignoreDraft = true
    editingTransferId.value = null
    editingRideId.value = null
    editingVersion.value = null
    applyDraft({
      clientId: fields.clientId,
      pickupWall: fields.pickupWall,
      startLocationId: fields.startLocationId,
      endLocationId: fields.endLocationId,
      passengers: fields.passengers,
      guest: fields.guest,
      tabla: fields.tabla,
      clientReference: fields.clientReference,
      flight: fields.flight,
      price: fields.price,
      payment: fields.payment,
      airportMark: fields.airportMark,
      luggage: fields.luggage,
      childSeats: fields.childSeats,
      note: fields.note,
    })
    // A copy is a new entry. It does not reuse the source Transfer's id.
    entryKey.value = transferEntryKey(opening)
    placeTarget.value = null
    clientTarget.value = false
    restored.value = false
    moreOpenNonce.value += 1
    ignoreDraft = false
    // The field watch already ran while updates were ignored. Write the
    // prefill so a reload does not bring back an older draft instead.
    if (options.persistDraft && import.meta.client) {
      rememberTransferDraft(
        localStorage,
        options.userId(),
        options.tenantId(),
        currentDraft(),
        new Date(),
        `${pickupDay}T12:00`,
      )
    }
  }

  /**
   * Fills the booking form from the row. The landing time stays on the board.
   * Cancel drops the values and does not save.
   */
  function openCorrect(ride: TransferDayRide) {
    clearFieldErrors()
    formErrorKey.value = null
    overlapOpen.value = false
    editingTransferId.value = ride.transferId
    editingRideId.value = ride.rideId
    editingVersion.value = ride.version
    clientId.value = ride.clientId
    pickupWall.value = wallClockInTimeZone(options.timeZone(), new Date(ride.pickupAt))
    startLocationId.value = ride.startLocationId
    endLocationId.value = ride.endLocationId
    passengers.value = String(ride.passengerCount)
    guest.value = ride.guestName
    tabla.value = ride.tabla
    clientReference.value = ride.clientReference ?? ''
    flight.value = ride.flightNumber ?? ''
    price.value = priceForForm(ride.price)
    payment.value = ride.payment
    airportMark.value = ride.airportMark
    luggage.value = String(ride.luggageCount)
    childSeats.value = String(ride.childSeatCount)
    note.value = ride.note ?? ''
    entryKey.value = transferEntryKey('correction')
    alreadySaved.value = false
    heldCreate = null
    placeTarget.value = null
    clientTarget.value = false
    restored.value = false
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
      clientReference: clientReference.value,
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
    const version = editingVersion.value
    options.saved.value = false
    options.corrected.value = false
    formErrorKey.value = null
    if (version === null || !transferId || !formReady() || !clientId.value || !startLocationId.value || !endLocationId.value || !payment.value) {
      markInvalid()
      return
    }
    pending.value = true
    try {
      const correction = correctedTransferResultSchema.parse(await $fetch(`/api/transfers/${transferId}`, {
        method: 'PATCH',
        body: {
          ...bookingBody(),
          version,
          ...(confirm ? { confirm: true } : {}),
        },
      }))
      overlapOpen.value = false
      options.corrected.value = true
      notifyAuditChanged()
      warnIfFullyBooked(correction.fullyBooked)
      if (correction.relocationWarnings.length > 0) {
        toast.add({
          title: t('ride.tightGap'),
          color: 'warning',
        })
      }
      // The notice names the Driver by id. The name is already on the day list.
      // A Ride with no Driver has no notice. The response has no address.
      for (const notice of correction.workOrders) {
        present(editingRideId.value ?? transferId, notice.outcome, driverLabel(notice.driverId), t('transfers.corrected'))
      }
      closeForm()
      await options.loadDay()
    }
    catch (error) {
      const reason = capacityDialogReason(errorCode(error))
      if (reason) {
        confirmReason.value = reason
        overlapOpen.value = true
        return
      }
      overlapOpen.value = false
      // A correction hands the refusal to the detail. Without that handler the form shows the error.
      if (errorCode(error) === 'stale_save' && options.onStale) {
        await options.onStale()
        return
      }
      formErrorKey.value = failureKey(error)
      markInvalid()
    }
    finally {
      pending.value = false
    }
  }

  async function record() {
    options.saved.value = false
    options.corrected.value = false
    formErrorKey.value = null
    if (alreadySaved.value)
      return
    if (!formReady() || !clientId.value || !startLocationId.value || !endLocationId.value || !payment.value) {
      markInvalid()
      return
    }
    pending.value = true
    try {
      const recorded = recordedCreateSchema.parse(await $fetch('/api/transfers', {
        method: 'POST',
        body: {
          ...bookingBody(),
          // Absent on a correction. A new entry always has one by the time it is sent.
          ...(entryKey.value ? { externalId: entryKey.value } : {}),
        },
      }))
      // The values on screen were not written. Keep them, and the key, until confirmed.
      if (recorded.alreadyRecorded) {
        heldCreate = recorded
        alreadySaved.value = true
        if (options.persistDraft && import.meta.client)
          applyTransferDraftEvent(localStorage, options.userId(), options.tenantId(), 'already-recorded')
        return
      }
      options.saved.value = true
      toast.add({ title: t('transfers.recorded') })
      warnIfFullyBooked(recorded.fullyBooked)
      const rideId = recorded.ride.id
      ignoreDraft = true
      if (options.persistDraft && import.meta.client)
        applyTransferDraftEvent(localStorage, options.userId(), options.tenantId(), 'save')
      formMode.value = null
      restored.value = false
      ignoreDraft = false
      options.day.value = operationalDateInTimeZone(options.timeZone(), new Date(recorded.transfer.pickupAt), options.operationalDayStartHour())
      await options.loadDay()
      options.onRecorded?.(rideId)
      options.onClose?.()
    }
    catch (error) {
      formErrorKey.value = failureKey(error)
      markInvalid()
    }
    finally {
      pending.value = false
    }
  }

  /** Confirming the already-saved notice drops the draft and opens that Ride. */
  async function confirmAlreadySaved() {
    const recorded = heldCreate
    if (!recorded)
      return
    pending.value = true
    try {
      ignoreDraft = true
      if (options.persistDraft && import.meta.client)
        applyTransferDraftEvent(localStorage, options.userId(), options.tenantId(), 'save')
      heldCreate = null
      alreadySaved.value = false
      formMode.value = null
      restored.value = false
      ignoreDraft = false
      options.day.value = operationalDateInTimeZone(options.timeZone(), new Date(recorded.transfer.pickupAt), options.operationalDayStartHour())
      await options.loadDay()
      options.onRecorded?.(recorded.ride.id)
      options.onClose?.()
    }
    finally {
      pending.value = false
    }
  }

  watch(
    () => options.persistDraft && formMode.value === 'add' ? currentDraft() : null,
    (draft) => {
      if (!import.meta.client || ignoreDraft || !options.persistDraft || draft === null)
        return
      rememberTransferDraft(localStorage, options.userId(), options.tenantId(), draft, new Date(), `${pickupDay}T12:00`)
    },
  )

  // Only the new-Transfer panel listens. A correction must not open a blank form.
  if (options.persistDraft) {
    const { nonce: newTransferNonce } = useNewTransferRequest()
    watch(newTransferNonce, (value) => {
      if (value === 0)
        return
      newTransferNonce.value = 0
      openAdd()
    }, { immediate: true })

    onMounted(() => {
      restoreDraft()
      // The panel mounts this after the day is ready. A click that landed
      // earlier still has to open a blank form when there is no draft.
      if (formMode.value === null)
        openAdd()
    })
  }

  return {
    clientId,
    pickupWall,
    startLocationId,
    endLocationId,
    passengers,
    guest,
    tabla,
    clientReference,
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
    heldPlace,
    clientTarget,
    clientName,
    clientKind,
    pending,
    placePending,
    alreadySaved,
    overlapOpen,
    confirmReason,
    formMode,
    formErrorKey,
    guestErrorKey,
    tablaErrorKey,
    clientReferenceErrorKey,
    flightErrorKey,
    noteErrorKey,
    priceErrorKey,
    passengerErrorKey,
    luggageErrorKey,
    seatErrorKey,
    pickupErrorKey,
    endErrorKey,
    clientErrorKey,
    startErrorKey,
    paymentErrorKey,
    placeNameErrorKey,
    placeKindErrorKey,
    clientNameErrorKey,
    clientKindErrorKey,
    validationNonce,
    moreOpenNonce,
    restored,
    clientItems,
    locationItems,
    paymentItems,
    kindItems,
    clientKindItems,
    formOpen,
    formTitle,
    openPlace,
    addPlace,
    openClient,
    addClient,
    discardDraft,
    openAdd,
    openPrefill,
    openCorrect,
    saveCorrection,
    record,
    confirmAlreadySaved,
  }
}
