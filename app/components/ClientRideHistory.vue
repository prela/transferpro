<script setup lang="ts">
import type { DisplayLocale, RideHistory, RideHistoryCounts, RideHistoryRow } from '../../shared'
import { formatInstant, rideHistorySchema } from '../../shared'
import { commandControlClass, commandControlSize } from '../ride-detail'
import { httpStatus } from '../transfer-day-http'

const props = defineProps<{
  clientId: string
  /** Phone uses the large target. Desktop uses the office size. */
  phone: boolean
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()

const rides = ref<RideHistoryRow[]>([])
const counts = ref<RideHistoryCounts | null>(null)
/** Absent when the server has no further page. The button follows this, not a guessed length. */
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const loadErrorKey = ref<RideFailure | null>(null)

type RideFailure = 'clients.rides.loadFailed' | 'clients.rides.rejected' | 'clients.rides.notFound' | 'clients.rides.forbidden' | 'clients.rides.signedOut'

function failureKey(error: unknown): RideFailure {
  switch (httpStatus(error)) {
    case 400: return 'clients.rides.rejected'
    case 401: return 'clients.rides.signedOut'
    case 403: return 'clients.rides.forbidden'
    case 404: return 'clients.rides.notFound'
    default: return 'clients.rides.loadFailed'
  }
}

/**
 * One page of this Client's Ride history. The cursor is the opaque token
 * from the previous page. Counts on every page cover the whole history,
 * including Rides this page does not return (ADR-0049).
 */
async function readPage(cursor: string | null): Promise<RideHistory> {
  return rideHistorySchema.parse(await $fetch(`/api/clients/${props.clientId}/ride-history`, {
    query: cursor === null ? {} : { cursor },
  }))
}

async function loadFirst() {
  loading.value = true
  loadErrorKey.value = null
  try {
    const page = await readPage(null)
    rides.value = page.rides
    counts.value = page.counts
    nextCursor.value = page.nextCursor
  }
  catch (error) {
    loadErrorKey.value = failureKey(error)
  }
  finally {
    loading.value = false
  }
}

/**
 * Append the next page. A failure keeps the rows already on screen: the
 * counts and the loaded Rides are still true.
 */
async function loadMore() {
  const cursor = nextCursor.value
  if (cursor === null || loadingMore.value)
    return
  loadingMore.value = true
  loadErrorKey.value = null
  try {
    const page = await readPage(cursor)
    rides.value = [...rides.value, ...page.rides]
    counts.value = page.counts
    nextCursor.value = page.nextCursor
  }
  catch (error) {
    loadErrorKey.value = failureKey(error)
  }
  finally {
    loadingMore.value = false
  }
}

/**
 * Pickup wall time in the Tenant zone. `pickupAt` stays the stored instant;
 * `formatInstant` is the one display path, so this row matches the Ride detail.
 */
function when(ride: RideHistoryRow): string {
  return formatInstant(new Date(ride.pickupAt), props.timeZone, props.locale)
}

/**
 * Who carried the Ride. A Driver and a Partner are alternatives: the Driver
 * when one is assigned, otherwise the Partner. `partnerName` stays null until
 * a Ride stores a Partner (#415). Neither name means the Ride is unassigned.
 */
function crew(ride: RideHistoryRow): string {
  return ride.driverName ?? ride.partnerName ?? t('transfers.unassignedCrew')
}

/** Croatian writes the decimal comma. The stored price stays `12.50`. */
function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}

onMounted(loadFirst)
</script>

<template>
  <section id="client-ride-history">
    <UAlert
      v-if="loadErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(loadErrorKey)"
    />
    <p
      v-if="loading"
      role="status"
    >
      {{ t('clients.rides.loading') }}
    </p>
    <template v-else-if="counts">
      <!-- Whole-history counts, not the length of the list below. -->
      <p class="mb-4 text-sm max-lg:text-base">
        {{ t('clients.rides.counts', counts) }}
      </p>
      <UEmpty
        v-if="rides.length === 0"
        :title="t('clients.rides.empty')"
        icon="i-lucide-route"
        variant="naked"
      />
      <ul v-else>
        <li
          v-for="ride in rides"
          :key="ride.rideId"
          class="border-b border-muted"
        >
          <!-- The operational day is the day list that can open this Ride. -->
          <NuxtLink
            :to="{ path: '/transfers', query: { day: ride.operationalDay, ride: ride.rideId } }"
            class="block min-h-11 rounded-md px-1 py-2 text-base focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary lg:min-h-7 lg:text-sm"
          >
            <span class="font-medium">{{ ride.guestName }}</span>
            <span class="mt-0.5 block tabular-nums text-muted">
              <time :datetime="ride.pickupAt">{{ when(ride) }}</time>
            </span>
            <span class="mt-0.5 block">{{ ride.start }} → {{ ride.end }}</span>
            <span class="mt-0.5 block">{{ t(`transfers.states.${ride.state}`) }} · {{ crew(ride) }}</span>
            <span class="mt-0.5 block tabular-nums">{{ priceLabel(ride.price) }} · {{ t(`transfers.payments.${ride.payment}`) }}</span>
          </NuxtLink>
        </li>
      </ul>
      <div
        v-if="nextCursor"
        class="mt-4"
      >
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="commandControlSize(phone)"
          class="w-full justify-center sm:w-auto"
          :class="commandControlClass(phone)"
          :loading="loadingMore"
          @click="loadMore"
        >
          {{ t('clients.rides.loadMore') }}
        </UButton>
      </div>
    </template>
  </section>
</template>
