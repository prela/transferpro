<script setup lang="ts">
import type { DisplayLocale, DriverUpcomingRide, LiveRefreshOutcome } from '../../shared'
import { canDeclineRide, canMarkNoShow, canMarkRideDone, clockLabel, driverUpcomingListSchema, leadDriverRide, noShowWaitElapsed, rideSchema } from '../../shared'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  refreshDocuments: () => Promise<void>
}>()

const { t } = useI18n()

const rides = ref<DriverUpcomingRide[]>([])
/** A later Ride the Driver opened. A refresh leaves it open (ADR-0039). */
const expandedId = ref<string | null>(null)
const airportWaitMinutes = ref<number | null>(null)
const elsewhereWaitMinutes = ref<number | null>(null)
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
// The Ride the Driver is about to mark a No-show. Null closes the dialog.
const markingNoShow = ref<DriverUpcomingRide | null>(null)
const markNoShowPending = ref(false)
const markNoShowErrorKey = ref<'driverRides.noShowConflict' | 'driverRides.noShowTooEarly' | 'driverRides.noShowFailed' | null>(null)
// The Ride the Driver is about to decline. Null closes the dialog.
const declining = ref<DriverUpcomingRide | null>(null)
const recordingLanding = ref<DriverUpcomingRide | null>(null)
const declinePending = ref(false)
const declineErrorKey = ref<'driverRides.declineConflict' | 'driverRides.declineFailed' | null>(null)
// A 409 means the list the Driver tapped was already stale.
const conflict = ref(false)
// A slower reload must not replace the rows from a newer one.
let loadTicket = 0

/**
 * The shared minute loop (ADR-0039). A failed refresh keeps the rows.
 * The first failure is the only one that replaces the list with the alert.
 * Documents follow the same read so the notice row does not go stale alone.
 */
async function reload(): Promise<LiveRefreshOutcome> {
  const ticket = ++loadTicket
  const first = rides.value.length === 0 && !loadError.value
  if (first)
    loading.value = true
  try {
    const list = driverUpcomingListSchema.parse(await $fetch('/api/rides/upcoming'))
    if (ticket !== loadTicket)
      return 'stale'
    rides.value = list.rides
    airportWaitMinutes.value = list.airportWaitMinutes
    elsewhereWaitMinutes.value = list.elsewhereWaitMinutes
    loadError.value = false
    if (expandedId.value !== null && !list.rides.some(ride => ride.rideId === expandedId.value))
      expandedId.value = null
    await props.refreshDocuments()
    return 'ok'
  }
  catch {
    if (ticket !== loadTicket)
      return 'stale'
    // The alert is a fixed sentence. The response body is not shown, so a
    // failed load cannot reveal a Client, an address, a note, a tabla, a
    // plate, or a guest name. A later failure keeps the cards.
    if (rides.value.length === 0)
      loadError.value = true
    return 'fail'
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

const announcedCount = ref(0)
const { automatic, refreshing, updatedAt, failed, refresh } = useLiveRefresh({
  reload,
  urgentKeys: () => [],
  onAnnounce(count) {
    announcedCount.value = count
  },
})

const split = computed(() => leadDriverRide(rides.value))
const shownTime = computed(() =>
  updatedAt.value === null ? '' : clockLabel(updatedAt.value, props.timeZone, props.locale),
)
const actionsLocked = computed(() =>
  acceptingId.value !== null || markDonePending.value || markNoShowPending.value || declinePending.value || recordingLanding.value !== null,
)

function toggleRide(rideId: string) {
  expandedId.value = expandedId.value === rideId ? null : rideId
}

async function onLandingSaved() {
  recordingLanding.value = null
  await refresh()
}

/**
 * Flag off: done from `assigned`. Flag on: done only from `accepted`.
 * Waiting on acceptance has the accept control and not this one.
 */
function canFinish(ride: DriverUpcomingRide): boolean {
  return canMarkRideDone(ride.state, ride.mustAccept)
}

/**
 * The same source state as done. The button stays disabled until the wait
 * the list just read has elapsed. The server still refuses an early mark.
 */
function canNoShow(ride: DriverUpcomingRide): boolean {
  const airport = airportWaitMinutes.value
  const elsewhere = elsewhereWaitMinutes.value
  if (!canMarkNoShow(ride.state, ride.mustAccept) || airport === null || elsewhere === null)
    return false
  return noShowWaitElapsed({
    airport: ride.airportMark,
    pickupAt: new Date(ride.pickupAt),
    landingAt: ride.landingAt === null ? null : new Date(ride.landingAt),
    airportWaitMinutes: airport,
    elsewhereWaitMinutes: elsewhere,
  }, new Date())
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
  if (acceptingId.value !== null || markDonePending.value || markNoShowPending.value || declinePending.value)
    return
  acceptingId.value = rideId
  try {
    rideSchema.parse(await $fetch(`/api/rides/${rideId}/accept`, {
      method: 'POST',
      body: {},
    }))
    // A tap is not success. The message stays until this accept succeeds.
    conflict.value = false
    await refresh()
  }
  catch (error) {
    // 409 is ride_not_acceptable on a Ride this Driver still holds.
    // 404 is a clear or a reassignment. Either way the list they tapped is stale.
    const status = httpStatus(error)
    if (status === 409 || status === 404) {
      conflict.value = true
      await refresh()
    }
  }
  finally {
    acceptingId.value = null
  }
}

function openMarkDone(ride: DriverUpcomingRide) {
  if (!canFinish(ride) || markDonePending.value || markNoShowPending.value || acceptingId.value !== null || declinePending.value)
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
    await refresh()
  }
  catch (error) {
    const status = httpStatus(error)
    if (status === 409 || status === 404) {
      markDoneErrorKey.value = 'driverRides.doneConflict'
      await refresh()
    }
    else {
      markDoneErrorKey.value = 'driverRides.doneFailed'
    }
  }
  finally {
    markDonePending.value = false
  }
}

function openMarkNoShow(ride: DriverUpcomingRide) {
  if (!canNoShow(ride) || markNoShowPending.value || markDonePending.value || acceptingId.value !== null || declinePending.value)
    return
  markNoShowErrorKey.value = null
  markingNoShow.value = ride
}

function closeMarkNoShow() {
  if (markNoShowPending.value)
    return
  markNoShowErrorKey.value = null
  markingNoShow.value = null
}

const markNoShowOpen = computed({
  get: () => markingNoShow.value !== null,
  set(open: boolean) {
    if (!open)
      closeMarkNoShow()
  },
})

function noShowErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error))
    return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('code' in data))
    return undefined
  return typeof data.code === 'string' ? data.code : undefined
}

/**
 * POST /api/rides/:id/no-show with an empty body. Success reloads the list,
 * and the Ride leaves it because a No-show is terminal. A too-early 409
 * leaves the Ride as it was. No fee is stored. No mail is sent.
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
    conflict.value = false
    markingNoShow.value = null
    await refresh()
  }
  catch (error) {
    const status = httpStatus(error)
    if (noShowErrorCode(error) === 'no_show_too_early')
      markNoShowErrorKey.value = 'driverRides.noShowTooEarly'
    else if (status === 409 || status === 404)
      markNoShowErrorKey.value = 'driverRides.noShowConflict'
    else
      markNoShowErrorKey.value = 'driverRides.noShowFailed'
    if (status === 409 || status === 404)
      await refresh()
  }
  finally {
    markNoShowPending.value = false
  }
}

function openDecline(ride: DriverUpcomingRide) {
  if (!canDecline(ride) || declinePending.value || acceptingId.value !== null || markDonePending.value || markNoShowPending.value)
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
    await refresh()
  }
  catch (error) {
    const status = httpStatus(error)
    if (status === 409 || status === 404) {
      declineErrorKey.value = 'driverRides.declineConflict'
      await refresh()
    }
    else {
      declineErrorKey.value = 'driverRides.declineFailed'
    }
  }
  finally {
    declinePending.value = false
  }
}
</script>

<template>
  <section class="mt-2">
    <!--
      The time is not a live region. The Driver list has no urgent item to
      announce (ADR-0039). The button stays enabled so a refresh does not
      drop focus. A failed refresh keeps the cards.
    -->
    <div
      class="mb-4 flex flex-wrap items-center gap-3"
      :aria-busy="refreshing"
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="min-h-12"
        @click="refresh()"
      >
        {{ t('liveRefresh.refresh') }}
      </UButton>
      <p
        v-if="updatedAt !== null"
        class="text-sm text-muted"
      >
        {{ failed ? t('liveRefresh.failed', { time: shownTime }) : t('liveRefresh.updatedAt', { time: shownTime }) }}
      </p>
      <UIcon
        v-if="refreshing"
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-muted motion-reduce:animate-none"
        aria-hidden="true"
      />
      <USwitch
        v-model="automatic"
        size="sm"
        class="min-h-12"
        :label="t('liveRefresh.automatic')"
      />
    </div>
    <p
      class="sr-only"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ announcedCount > 0 ? t('liveRefresh.newUrgent') : '' }}
    </p>
    <UAlert
      v-if="loadError && rides.length === 0"
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
      v-if="loading && rides.length === 0 && !loadError"
      role="status"
    >
      {{ t('driverRides.loading') }}
    </p>
    <template v-else-if="!loadError || rides.length > 0">
      <h2
        v-if="!split.next"
        class="mb-3 text-xl font-semibold"
      >
        {{ t('driverRides.title') }}
      </h2>
      <p v-if="!loading && !split.next && !loadError">
        {{ t('driverRides.empty') }}
      </p>
      <DriverRideCard
        v-if="split.next && airportWaitMinutes !== null && elsewhereWaitMinutes !== null"
        :ride="split.next"
        :time-zone="timeZone"
        :locale="locale"
        lead
        :expanded="true"
        :airport-wait-minutes="airportWaitMinutes"
        :elsewhere-wait-minutes="elsewhereWaitMinutes"
        :actions-locked="actionsLocked"
        :accepting="acceptingId === split.next.rideId"
        @accept="accept(split.next.rideId)"
        @decline="openDecline(split.next)"
        @done="openMarkDone(split.next)"
        @no-show="openMarkNoShow(split.next)"
        @landing="recordingLanding = split.next"
      />
      <ul
        v-if="split.rest.length > 0"
        class="mt-3 flex flex-col gap-3"
      >
        <li
          v-for="ride in split.rest"
          :key="ride.rideId"
        >
          <DriverRideCard
            v-if="airportWaitMinutes !== null && elsewhereWaitMinutes !== null"
            :ride="ride"
            :time-zone="timeZone"
            :locale="locale"
            :lead="false"
            :expanded="expandedId === ride.rideId"
            :airport-wait-minutes="airportWaitMinutes"
            :elsewhere-wait-minutes="elsewhereWaitMinutes"
            :actions-locked="actionsLocked"
            :accepting="acceptingId === ride.rideId"
            @toggle="toggleRide(ride.rideId)"
            @accept="accept(ride.rideId)"
            @decline="openDecline(ride)"
            @done="openMarkDone(ride)"
            @no-show="openMarkNoShow(ride)"
            @landing="recordingLanding = ride"
          />
        </li>
      </ul>
    </template>
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
      v-model:open="markNoShowOpen"
      :title="t('driverRides.noShowTitle')"
      :description="t('driverRides.noShowBody')"
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
          {{ markNoShowPending ? t('driverRides.noShowConfirming') : t('driverRides.noShowConfirm') }}
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
    <RideLanding
      v-if="recordingLanding"
      :key="recordingLanding.rideId"
      :ride-id="recordingLanding.rideId"
      :guest-name="recordingLanding.guestName"
      :landing-at="recordingLanding.landingAt"
      :time-zone="timeZone"
      phone
      @saved="onLandingSaved"
      @cancel="recordingLanding = null"
    />
  </section>
</template>
