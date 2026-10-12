<script setup lang="ts">
import type { DisplayLocale, DriverUpcomingRide } from '../../shared'
import { canDeclineRide, canMarkRideDone, driverUpcomingListSchema, formatInstant, rideSchema } from '../../shared'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()
const titleId = useId()

const rides = ref<DriverUpcomingRide[]>([])
// Start true so the empty copy does not flash before the first read.
const loading = ref(true)
const loadError = ref(false)
// One accept at a time. The id stays set until the list has caught up,
// so the control cannot flash back onto a Ride that just left `assigned`.
const acceptingId = ref<string | null>(null)
// The Ride the Driver is about to mark done. Null closes the dialog.
const markingDone = ref<DriverUpcomingRide | null>(null)
const markDonePending = ref(false)
const markDoneErrorKey = ref<'driverRides.doneConflict' | 'driverRides.doneFailed' | null>(null)
// The Ride the Driver is about to decline. Null closes the dialog.
const declining = ref<DriverUpcomingRide | null>(null)
const declinePending = ref(false)
const declineErrorKey = ref<'driverRides.declineConflict' | 'driverRides.declineFailed' | null>(null)
// A 409 means the list the Driver tapped was already stale.
const conflict = ref(false)
// A slower reload must not replace the rows from a newer one.
let loadTicket = 0

async function loadRides(refresh = false) {
  const ticket = ++loadTicket
  // A refresh keeps the cards on screen. The first read still shows loading
  // so the empty copy does not flash.
  if (!refresh)
    loading.value = true
  loadError.value = false
  try {
    const next = driverUpcomingListSchema.parse(await $fetch('/api/rides/upcoming')).rides
    if (ticket !== loadTicket)
      return
    rides.value = next
  }
  catch {
    if (ticket !== loadTicket)
      return
    // The alert is a fixed sentence. The response body is not shown, so a
    // failed load cannot reveal a Client, an address, a note, a tabla, a
    // plate, or a guest name.
    loadError.value = true
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

/**
 * The copied flag and `assigned` are both required. An accepted Ride still
 * has the flag, and an assigned Ride that does not require acceptance has
 * no control.
 */
function canAccept(ride: DriverUpcomingRide): boolean {
  return ride.state === 'assigned' && ride.mustAccept
}

/**
 * Flag off: done from `assigned`. Flag on: done only from `accepted`.
 * Waiting on acceptance has the accept control and not this one.
 */
function canFinish(ride: DriverUpcomingRide): boolean {
  return canMarkRideDone(ride.state, ride.mustAccept)
}

/** Assigned only. The copied flag does not matter (ADR-0006). */
function canDecline(ride: DriverUpcomingRide): boolean {
  return canDeclineRide(ride.state)
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

/**
 * POST /api/rides/:id/accept with an empty body. Success, a 409, and a 404
 * all reload the list. A 409 is a Ride this Driver still holds. A 404 drops
 * the card, because the Ride is no longer theirs. The conflict alert stays
 * until a later accept succeeds. Any other failure leaves the control so
 * the Driver can try again. This action does not send mail.
 */
async function accept(rideId: string) {
  if (acceptingId.value !== null || markDonePending.value || declinePending.value)
    return
  acceptingId.value = rideId
  try {
    rideSchema.parse(await $fetch(`/api/rides/${rideId}/accept`, {
      method: 'POST',
      body: {},
    }))
    // A tap is not success. The message stays until this accept succeeds.
    conflict.value = false
    await loadRides(true)
  }
  catch (error) {
    // 409 is ride_not_acceptable on a Ride this Driver still holds.
    // 404 is a clear or a reassignment. Either way the list they tapped is stale.
    const status = httpStatus(error)
    if (status === 409 || status === 404) {
      conflict.value = true
      await loadRides(true)
    }
  }
  finally {
    acceptingId.value = null
  }
}

function openMarkDone(ride: DriverUpcomingRide) {
  if (!canFinish(ride) || markDonePending.value || acceptingId.value !== null || declinePending.value)
    return
  markDoneErrorKey.value = null
  markingDone.value = ride
}

function closeMarkDone() {
  if (markDonePending.value)
    return
  markDoneErrorKey.value = null
  markingDone.value = null
}

const markDoneOpen = computed({
  get: () => markingDone.value !== null,
  set(open: boolean) {
    if (!open)
      closeMarkDone()
  },
})

/**
 * POST /api/rides/:id/done with an empty body. Success reloads the list,
 * and the Ride leaves it because done is terminal. A 409 or a 404 reloads
 * and says the Ride can no longer be marked done. No mail is sent.
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
    conflict.value = false
    markingDone.value = null
    await loadRides(true)
  }
  catch (error) {
    const status = httpStatus(error)
    if (status === 409 || status === 404) {
      markDoneErrorKey.value = 'driverRides.doneConflict'
      await loadRides(true)
    }
    else {
      markDoneErrorKey.value = 'driverRides.doneFailed'
    }
  }
  finally {
    markDonePending.value = false
  }
}

function openDecline(ride: DriverUpcomingRide) {
  if (!canDecline(ride) || declinePending.value || acceptingId.value !== null || markDonePending.value)
    return
  declineErrorKey.value = null
  declining.value = ride
}

function closeDecline() {
  if (declinePending.value)
    return
  declineErrorKey.value = null
  declining.value = null
}

const declineOpen = computed({
  get: () => declining.value !== null,
  set(open: boolean) {
    if (!open)
      closeDecline()
  },
})

/**
 * POST /api/rides/:id/decline with an empty body. Success reloads the list,
 * and the Ride leaves it because it is no longer this Driver's. A 409 or a
 * 404 reloads and says the Ride can no longer be declined. No mail is sent.
 */
async function confirmDecline() {
  const target = declining.value
  if (!target || declinePending.value)
    return
  declinePending.value = true
  declineErrorKey.value = null
  try {
    rideSchema.parse(await $fetch(`/api/rides/${target.rideId}/decline`, {
      method: 'POST',
      body: {},
    }))
    conflict.value = false
    declining.value = null
    await loadRides(true)
  }
  catch (error) {
    const status = httpStatus(error)
    if (status === 409 || status === 404) {
      declineErrorKey.value = 'driverRides.declineConflict'
      await loadRides(true)
    }
    else {
      declineErrorKey.value = 'driverRides.declineFailed'
    }
  }
  finally {
    declinePending.value = false
  }
}

function pickupLabel(pickupAt: string): string {
  return formatInstant(new Date(pickupAt), props.timeZone, props.locale)
}

/** EUR, two decimals. Croatian uses a comma. The stored value stays a dot. */
function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}

onMounted(loadRides)
</script>

<template>
  <section
    class="mt-2"
    :aria-labelledby="titleId"
  >
    <h2
      :id="titleId"
      class="mb-3 text-xl font-semibold"
    >
      {{ t('driverRides.title') }}
    </h2>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      :description="t('driverRides.loadFailed')"
    />
    <UAlert
      v-if="conflict"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-3"
      :description="t('driverRides.conflict')"
    />
    <p
      v-if="!loadError && loading"
      role="status"
    >
      {{ t('driverRides.loading') }}
    </p>
    <p v-else-if="!loadError && rides.length === 0">
      {{ t('driverRides.empty') }}
    </p>
    <ul
      v-else-if="!loadError"
      class="flex flex-col gap-3"
    >
      <li
        v-for="ride in rides"
        :key="ride.rideId"
      >
        <article class="rounded-lg border border-default bg-default p-4 text-base">
          <h3 class="text-lg font-semibold">
            {{ ride.guestName }}
          </h3>
          <!--
            Accepted uses the office label. Waiting is only an assigned Ride
            that still requires acceptance. A Ride that does not require
            acceptance has no status line. The control uses the same pair:
            `assigned` and the copied flag.
          -->
          <p
            v-if="ride.state === 'accepted'"
            class="mt-1"
          >
            {{ t('transfers.states.accepted') }}
          </p>
          <p
            v-else-if="ride.mustAccept"
            class="mt-1"
          >
            {{ t('driverRides.waiting') }}
          </p>
          <time
            class="mt-1 block"
            :datetime="ride.pickupAt"
          >
            {{ pickupLabel(ride.pickupAt) }}
          </time>
          <dl class="mt-3 grid grid-cols-1 gap-2">
            <div>
              <dt class="text-sm text-muted">
                {{ t('transfers.client') }}
              </dt>
              <dd class="break-words">
                {{ ride.clientName }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('clients.kind') }}
              </dt>
              <dd>{{ t(`clients.kinds.${ride.clientKind}`) }}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('driverRides.from') }}
              </dt>
              <dd class="break-words">
                {{ ride.from }}
              </dd>
            </div>
            <!-- A missing address is not a blank line. An archived Location still has its line. -->
            <div v-if="ride.fromAddress">
              <dt class="text-sm text-muted">
                {{ t('locations.address') }}
              </dt>
              <dd class="break-words">
                {{ ride.fromAddress }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('driverRides.to') }}
              </dt>
              <dd class="break-words">
                {{ ride.to }}
              </dd>
            </div>
            <div v-if="ride.toAddress">
              <dt class="text-sm text-muted">
                {{ t('locations.address') }}
              </dt>
              <dd class="break-words">
                {{ ride.toAddress }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('driverRides.passengers') }}
              </dt>
              <dd>{{ ride.passengerCount }}</dd>
            </div>
            <!-- Zero is a fact: the Driver still needs to see that there is no bag and no seat. -->
            <div>
              <dt class="text-sm text-muted">
                {{ t('transfers.luggage') }}
              </dt>
              <dd>{{ ride.luggageCount }}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('transfers.childSeats') }}
              </dt>
              <dd>{{ ride.childSeatCount }}</dd>
            </div>
            <div v-if="ride.flightNumber">
              <dt class="text-sm text-muted">
                {{ t('driverRides.flight') }}
              </dt>
              <dd>{{ ride.flightNumber }}</dd>
            </div>
            <div v-if="ride.landingAt">
              <dt class="text-sm text-muted">
                {{ t('driverRides.landing') }}
              </dt>
              <dd>
                <time :datetime="ride.landingAt">
                  {{ pickupLabel(ride.landingAt) }}
                </time>
              </dd>
            </div>
            <div v-if="ride.note">
              <dt class="text-sm text-muted">
                {{ t('transfers.note') }}
              </dt>
              <dd class="break-words whitespace-pre-wrap">
                {{ ride.note }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('vehicles.registrationPlate') }}
              </dt>
              <dd>{{ ride.registrationPlate }}</dd>
            </div>
            <div v-if="ride.tabla">
              <dt class="text-sm text-muted">
                {{ t('transfers.tabla') }}
              </dt>
              <dd class="break-words whitespace-pre-wrap">
                {{ ride.tabla }}
              </dd>
            </div>
            <!--
              Cash only. Card and invoice to agency render neither the price
              nor a method, including as hidden text (ADR-0009, ADR-0020).
            -->
            <div v-if="ride.payment === 'cash' && ride.price">
              <dt class="text-sm text-muted">
                {{ t('driverRides.price') }}
              </dt>
              <dd>{{ priceLabel(ride.price) }}</dd>
              <dd>{{ t('driverRides.cash') }}</dd>
            </div>
          </dl>
          <p
            v-if="ride.airportMark"
            class="mt-2"
          >
            {{ t('driverRides.airport') }}
          </p>
          <UButton
            v-if="canAccept(ride)"
            type="button"
            size="xl"
            class="mt-4 w-full justify-center"
            :loading="acceptingId === ride.rideId"
            :disabled="acceptingId !== null || markDonePending || declinePending"
            @click="accept(ride.rideId)"
          >
            {{ acceptingId === ride.rideId ? t('driverRides.accepting') : t('driverRides.accept') }}
          </UButton>
          <UButton
            v-if="canDecline(ride)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            class="mt-4 w-full justify-center"
            :disabled="acceptingId !== null || markDonePending || declinePending"
            @click="openDecline(ride)"
          >
            {{ t('driverRides.decline') }}
          </UButton>
          <UButton
            v-if="canFinish(ride)"
            type="button"
            size="xl"
            class="mt-4 w-full justify-center"
            :disabled="acceptingId !== null || markDonePending || declinePending"
            @click="openMarkDone(ride)"
          >
            {{ t('driverRides.done') }}
          </UButton>
        </article>
      </li>
    </ul>
    <UModal
      v-model:open="markDoneOpen"
      :title="t('driverRides.doneTitle')"
      :description="t('driverRides.doneBody')"
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
          {{ markDonePending ? t('driverRides.doneConfirming') : t('driverRides.doneConfirm') }}
        </UButton>
      </template>
    </UModal>
    <UModal
      v-model:open="declineOpen"
      :title="t('driverRides.declineTitle')"
      :description="t('driverRides.declineBody')"
      :dismissible="!declinePending"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p v-if="declining">
          {{ declining.guestName }}
        </p>
        <UAlert
          v-if="declineErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mt-4"
          :description="t(declineErrorKey)"
        />
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="declinePending"
          @click="closeDecline"
        >
          {{ t('ride.cancel') }}
        </UButton>
        <UButton
          type="button"
          color="error"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="declinePending"
          :disabled="declinePending"
          @click="confirmDecline"
        >
          {{ declinePending ? t('driverRides.declineConfirming') : t('driverRides.declineConfirm') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
