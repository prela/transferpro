<script setup lang="ts">
import type { Client, DisplayLocale, Driver, Location, LocationKind, PaymentMethod, TransferDayRide, Vehicle } from '../../shared'
import { calendarDateInTimeZone, childSeatCountError, clientListSchema, driverListSchema, flightNumberError, formatInstant, guestNameError, instantFromWallClock, isCalendarDate, locationKindError, locationListSchema, locationNameError, locationSchema, luggageCountError, noteError, passengerCountError, pickupAtError, priceError, priceFromInput, recordedTransferSchema, sameLocationError, transferDaySchema, vehicleListSchema } from '../../shared'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()

const today = calendarDateInTimeZone(props.timeZone, new Date())
const day = ref(today)
const rides = ref<TransferDayRide[]>([])
const clients = ref<Client[]>([])
const locations = ref<Location[]>([])
const drivers = ref<Driver[]>([])
const vehicles = ref<Vehicle[]>([])
const assigning = ref<{ rideId: string, guestName: string } | null>(null)

const clientId = ref<string | undefined>()
const pickupWall = ref(`${today}T12:00`)
const startLocationId = ref<string | undefined>()
const endLocationId = ref<string | undefined>()
const passengers = ref('1')
const guest = ref('')
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
const formErrorKey = ref<TransferFailure | null>(null)
const guestErrorKey = ref<'transfers.guestEmpty' | 'transfers.guestTooLong' | null>(null)
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
    | 'locations.saveFailed'

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
  { accessorKey: 'guestName' as const, header: t('transfers.guest') },
  { id: 'start', header: t('transfers.start') },
  { id: 'end', header: t('transfers.end') },
  { id: 'state', header: t('transfers.status') },
  { id: 'driver', header: t('ride.driver') },
  { id: 'vehicle', header: t('ride.vehicle') },
  { id: 'actions', header: '' },
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

function vehicleLabel(id: string | null): string {
  if (id === null)
    return ''
  return vehicles.value.find(vehicle => vehicle.id === id)?.registrationPlate ?? t('ride.unknownVehicle')
}

function openAssign(ride: TransferDayRide) {
  assigning.value = { rideId: ride.rideId, guestName: ride.guestName }
}

function onAssigned() {
  void loadDay()
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
  switch (httpStatus(error)) {
    case 400: return 'transfers.rejected'
    case 401: return 'transfers.signedOut'
    case 403: return 'transfers.forbidden'
    case 404: return 'transfers.notFound'
    default: return 'transfers.saveFailed'
  }
}

async function loadCatalogs() {
  const [clientList, locationList, driverList, vehicleList] = await Promise.all([
    clientListSchema.parse(await $fetch('/api/clients')),
    // Archived rows stay in the catalog so a Ride keeps its place name.
    // The record form still offers only places that are not archived.
    locationListSchema.parse(await $fetch('/api/locations', { query: { includeArchived: 'true' } })),
    driverListSchema.parse(await $fetch('/api/drivers')),
    // Archived Vehicles stay out of this list, so the assign picker cannot offer one.
    vehicleListSchema.parse(await $fetch('/api/vehicles')),
  ])
  clients.value = clientList.clients
  locations.value = locationList.locations
  drivers.value = driverList.drivers
  vehicles.value = vehicleList.vehicles
}

async function loadDay(ticket = ++loadTicket) {
  if (!isCalendarDate(day.value))
    return
  loading.value = true
  loadError.value = false
  try {
    const listed = transferDaySchema.parse(await $fetch('/api/transfers', { query: { date: day.value } }))
    if (ticket !== loadTicket)
      return
    rides.value = listed.rides
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
  loading.value = true
  loadError.value = false
  try {
    await loadCatalogs()
    await loadDay()
  }
  catch {
    loadError.value = true
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

async function record() {
  saved.value = false
  formErrorKey.value = null
  if (!formReady() || !clientId.value || !startLocationId.value || !endLocationId.value || !payment.value) {
    if (!clientId.value || !startLocationId.value || !endLocationId.value || !payment.value)
      formErrorKey.value = 'transfers.rejected'
    return
  }
  pending.value = true
  try {
    const pickupAt = instantFromWallClock(pickupWall.value.slice(0, 16), props.timeZone).toISOString()
    const recorded = recordedTransferSchema.parse(await $fetch('/api/transfers', {
      method: 'POST',
      body: {
        clientId: clientId.value,
        pickupAt,
        startLocationId: startLocationId.value,
        endLocationId: endLocationId.value,
        passengerCount: Number(passengers.value),
        guestName: guest.value,
        flightNumber: flight.value,
        price: priceFromInput(price.value),
        payment: payment.value,
        airportMark: airportMark.value,
        luggageCount: Number(luggage.value),
        childSeatCount: Number(childSeats.value),
        note: note.value,
      },
    }))
    guest.value = ''
    flight.value = ''
    note.value = ''
    saved.value = true
    day.value = calendarDateInTimeZone(props.timeZone, new Date(recorded.transfer.pickupAt))
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
  void loadDay()
})

onMounted(loadAll)
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

    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t('transfers.loadFailed')"
    />
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('transfers.loading') }}
    </p>
    <p v-else-if="rides.length === 0">
      {{ t('transfers.empty') }}
    </p>
    <div
      v-else
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
        <template #start-cell="{ row }">
          {{ placeLabel(row.original.startLocationId) }}
        </template>
        <template #end-cell="{ row }">
          {{ placeLabel(row.original.endLocationId) }}
        </template>
        <template #state-cell="{ row }">
          {{ t(`transfers.states.${row.original.state}`) }}
        </template>
        <template #driver-cell="{ row }">
          {{ driverLabel(row.original.driverId) }}
        </template>
        <template #vehicle-cell="{ row }">
          {{ vehicleLabel(row.original.vehicleId) }}
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="row.original.state === 'unassigned'"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            @click="openAssign(row.original)"
          >
            {{ t('ride.assign') }}
          </UButton>
        </template>
      </UTable>
    </div>

    <RideAssign
      v-if="assigning"
      :ride-id="assigning.rideId"
      :guest-name="assigning.guestName"
      :drivers="drivers"
      :vehicles="vehicles"
      @assigned="onAssigned"
    />

    <h2 class="mt-6 mb-4 text-xl font-semibold">
      {{ t('transfers.add') }}
    </h2>
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

    <form @submit.prevent="record">
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
      <UButton
        type="submit"
        size="xl"
        :loading="pending"
      >
        {{ pending ? t('transfers.submitting') : t('transfers.submit') }}
      </UButton>
    </form>
  </section>
</template>
