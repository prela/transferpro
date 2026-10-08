<script setup lang="ts">
import type { DisplayLocale, DriverUpcomingRide } from '../../shared'
import { driverUpcomingListSchema, formatInstant, rideSchema } from '../../shared'

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
 * POST /api/rides/:id/accept with an empty body. Success and a 409 both
 * reload the list: the Ride stays, and the control follows the new row.
 * Any other failure leaves the control so the Driver can try again.
 * This action does not send mail.
 */
async function accept(rideId: string) {
  if (acceptingId.value !== null)
    return
  acceptingId.value = rideId
  conflict.value = false
  try {
    rideSchema.parse(await $fetch(`/api/rides/${rideId}/accept`, {
      method: 'POST',
      body: {},
    }))
    await loadRides(true)
  }
  catch (error) {
    // 409 is ride_not_acceptable: the flag is off, or the Ride is no longer assigned.
    if (httpStatus(error) === 409) {
      conflict.value = true
      await loadRides(true)
    }
  }
  finally {
    acceptingId.value = null
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
                {{ t('driverRides.from') }}
              </dt>
              <dd>{{ ride.from }}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('driverRides.to') }}
              </dt>
              <dd>{{ ride.to }}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted">
                {{ t('driverRides.passengers') }}
              </dt>
              <dd>{{ ride.passengerCount }}</dd>
            </div>
            <div v-if="ride.flightNumber">
              <dt class="text-sm text-muted">
                {{ t('driverRides.flight') }}
              </dt>
              <dd>{{ ride.flightNumber }}</dd>
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
            :disabled="acceptingId !== null"
            @click="accept(ride.rideId)"
          >
            {{ acceptingId === ride.rideId ? t('driverRides.accepting') : t('driverRides.accept') }}
          </UButton>
        </article>
      </li>
    </ul>
  </section>
</template>
