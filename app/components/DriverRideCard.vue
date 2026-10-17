<script setup lang="ts">
import type { DisplayLocale, DriverUpcomingRide } from '../../shared'
import { canDeclineRide, canMarkNoShow, canMarkRideDone, canRecordLandingTime, formatInstant, noShowWaitBounds, noShowWaitElapsed } from '../../shared'

const props = defineProps<{
  ride: DriverUpcomingRide
  timeZone: string
  locale: DisplayLocale
  /** The soonest Ride stays open. Later Rides start as a compact row. */
  lead: boolean
  expanded: boolean
  airportWaitMinutes: number
  elsewhereWaitMinutes: number
  actionsLocked: boolean
  accepting: boolean
}>()

const emit = defineEmits<{
  toggle: []
  accept: []
  decline: []
  done: []
  noShow: []
  landing: []
}>()

const { t } = useI18n()
const titleId = useId()
const panelId = useId()

const open = computed(() => props.lead || props.expanded)

function pickupLabel(instant: string): string {
  return formatInstant(new Date(instant), props.timeZone, props.locale)
}

/** EUR, two decimals. Croatian uses a comma. The stored value stays a dot. */
function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}

/**
 * Accepted uses the office label. Waiting is only an assigned Ride that
 * still requires acceptance. A Ride that does not require acceptance is
 * assigned, which is still a state the card has to say.
 */
const stateLabel = computed(() => {
  if (props.ride.state === 'accepted')
    return t('transfers.states.accepted')
  if (props.ride.mustAccept)
    return t('driverRides.waiting')
  return t('transfers.states.assigned')
})

const waiting = computed(() => props.ride.state === 'assigned' && props.ride.mustAccept)
const canFinish = computed(() => canMarkRideDone(props.ride.state, props.ride.mustAccept))
const canDecline = computed(() => canDeclineRide(props.ride.state))

const noShowClock = computed(() => ({
  airport: props.ride.airportMark,
  pickupAt: new Date(props.ride.pickupAt),
  landingAt: props.ride.landingAt === null ? null : new Date(props.ride.landingAt),
  airportWaitMinutes: props.airportWaitMinutes,
  elsewhereWaitMinutes: props.elsewhereWaitMinutes,
}))

const showNoShow = computed(() => canMarkNoShow(props.ride.state, props.ride.mustAccept))
const noShowReady = computed(() => showNoShow.value && noShowWaitElapsed(noShowClock.value, new Date()))

/**
 * The control stays on the card before the wait, disabled, and names the
 * window so the Driver can see from when until when (ADR-0007).
 */
const noShowLabel = computed(() => {
  const bounds = noShowWaitBounds(noShowClock.value)
  return t('driverRides.noShowWindow', {
    from: pickupLabel(bounds.from.toISOString()),
    until: pickupLabel(bounds.until.toISOString()),
  })
})

const showLanding = computed(() => props.ride.airportMark && canRecordLandingTime(props.ride.state))
</script>

<template>
  <article class="rounded-lg border border-default bg-default p-4 text-base">
    <!--
      A later Ride is one row until the Driver taps it. The guest stays in
      the button name so the row can be found while it is closed.
    -->
    <button
      v-if="!lead"
      type="button"
      class="flex min-h-12 w-full items-center gap-3 text-left"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      @click="emit('toggle')"
    >
      <span class="shrink-0 font-semibold tabular-nums">{{ pickupLabel(ride.pickupAt) }}</span>
      <span class="min-w-0 flex-1 truncate">{{ ride.guestName }} · {{ ride.passengerCount }}</span>
      <span class="shrink-0">{{ stateLabel }}</span>
    </button>
    <div
      v-if="open"
      :id="lead ? undefined : panelId"
    >
      <h2
        v-if="lead"
        :id="titleId"
        class="text-sm font-semibold text-muted"
      >
        {{ t('driverRides.title') }}
      </h2>
      <p
        v-if="lead"
        class="mt-1 text-3xl font-semibold tabular-nums"
      >
        <time :datetime="ride.pickupAt">{{ pickupLabel(ride.pickupAt) }}</time>
      </p>
      <p
        v-if="lead"
        class="mt-1"
      >
        {{ stateLabel }}
      </p>
      <h3
        class="font-semibold"
        :class="lead ? 'mt-3 text-lg' : 'mt-3'"
      >
        {{ ride.guestName }}
      </h3>
      <!--
        An airport pickup names the flight with the landed time, or the
        expected time when nobody has recorded a landing (ADR-0038).
      -->
      <div
        v-if="ride.airportMark && (ride.flightNumber || ride.landingAt || ride.expectedArrival)"
        class="mt-3"
      >
        <p
          v-if="ride.flightNumber"
          class="font-mono text-lg"
        >
          {{ ride.flightNumber }}
        </p>
        <p v-if="ride.landingAt">
          <time :datetime="ride.landingAt">{{ pickupLabel(ride.landingAt) }}</time>
        </p>
        <p v-else-if="ride.expectedArrival">
          {{ t('driverRides.expectedArrival') }}
          <time :datetime="ride.expectedArrival">{{ pickupLabel(ride.expectedArrival) }}</time>
        </p>
      </div>
      <dl class="mt-3 grid grid-cols-1 gap-2">
        <div>
          <dt class="text-sm text-muted">
            {{ t('driverRides.from') }}
          </dt>
          <dd class="break-words">
            {{ ride.from }}
          </dd>
          <dd>
            <UButton
              :to="ride.fromMapsUrl"
              target="_blank"
              external
              :locale="false"
              variant="link"
              color="primary"
              size="xl"
              class="min-h-12 px-0"
              :label="t('driverRides.openInMaps')"
            />
          </dd>
        </div>
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
          <dd>
            <UButton
              :to="ride.toMapsUrl"
              target="_blank"
              external
              :locale="false"
              variant="link"
              color="primary"
              size="xl"
              class="min-h-12 px-0"
              :label="t('driverRides.openInMaps')"
            />
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
            {{ t('driverRides.passengers') }}
          </dt>
          <dd class="tabular-nums">
            {{ ride.passengerCount }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">
            {{ t('transfers.luggage') }}
          </dt>
          <dd class="tabular-nums">
            {{ ride.luggageCount }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">
            {{ t('transfers.childSeats') }}
          </dt>
          <dd class="tabular-nums">
            {{ ride.childSeatCount }}
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
          <dd class="font-mono">
            {{ ride.registrationPlate }}
          </dd>
        </div>
        <!--
          The meet sign is the text the Driver holds up. It stays large
          even when the rest of the card is secondary (ADR-0038).
        -->
        <div v-if="ride.tabla">
          <dt class="text-sm text-muted">
            {{ t('transfers.tabla') }}
          </dt>
          <dd class="break-words text-2xl font-semibold whitespace-pre-wrap">
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
          <dd class="tabular-nums">
            {{ priceLabel(ride.price) }}
          </dd>
          <dd>{{ t('driverRides.cash') }}</dd>
        </div>
      </dl>
      <p
        v-if="ride.airportMark"
        class="mt-2"
      >
        {{ t('driverRides.airport') }}
      </p>
      <!--
        Waiting on acceptance: Prihvati fills the row and Odbij sits beside
        it. Every other state has one full-width primary, Obavljeno.
        48 px is the Driver target (ADR-0038).
      -->
      <div
        v-if="waiting"
        class="mt-4 flex gap-2"
      >
        <UButton
          type="button"
          size="xl"
          class="min-h-12 flex-1 justify-center"
          :loading="accepting"
          :disabled="actionsLocked"
          @click="emit('accept')"
        >
          {{ accepting ? t('driverRides.accepting') : t('driverRides.accept') }}
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="min-h-12 justify-center"
          :disabled="actionsLocked"
          @click="emit('decline')"
        >
          {{ t('driverRides.decline') }}
        </UButton>
      </div>
      <template v-else>
        <UButton
          v-if="canFinish"
          type="button"
          size="xl"
          class="mt-4 min-h-12 w-full justify-center"
          :disabled="actionsLocked"
          @click="emit('done')"
        >
          {{ t('driverRides.done') }}
        </UButton>
        <UButton
          v-if="showLanding"
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="mt-2 min-h-12 w-full justify-center"
          :disabled="actionsLocked"
          @click="emit('landing')"
        >
          {{ t('ride.recordLandingTitle') }}
        </UButton>
        <UButton
          v-if="showNoShow"
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="mt-2 min-h-12 w-full justify-center"
          :disabled="actionsLocked || !noShowReady"
          @click="emit('noShow')"
        >
          {{ noShowLabel }}
        </UButton>
        <UButton
          v-if="canDecline"
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="mt-2 min-h-12 w-full justify-center"
          :disabled="actionsLocked"
          @click="emit('decline')"
        >
          {{ t('driverRides.decline') }}
        </UButton>
      </template>
    </div>
  </article>
</template>
