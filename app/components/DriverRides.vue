<script setup lang="ts">
import type { DisplayLocale, DriverUpcomingRide } from '../../shared'
import { driverUpcomingListSchema, formatInstant } from '../../shared'

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
// A slower reload must not replace the rows from a newer one.
let loadTicket = 0

async function loadRides() {
  const ticket = ++loadTicket
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
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('driverRides.loading') }}
    </p>
    <p v-else-if="rides.length === 0">
      {{ t('driverRides.empty') }}
    </p>
    <ul
      v-else
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
            acceptance has no status line. There is no accept control here.
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
        </article>
      </li>
    </ul>
  </section>
</template>
