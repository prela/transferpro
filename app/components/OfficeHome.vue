<script setup lang="ts">
import type { DisplayLocale, LiveRefreshOutcome, OfficeHome } from '../../shared'
import { clockLabel, officeHomeSchema, officeHomeUrgentKeys } from '../../shared'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  refreshDocuments: () => Promise<void>
}>()

const { t } = useI18n()
const countsTitleId = useId()
const unassignedTitleId = useId()
const waitingTitleId = useId()
const progressTitleId = useId()

const snapshot = ref<OfficeHome | null>(null)
// Start true so the empty copy does not flash before the first read.
const loading = ref(true)
const loadError = ref(false)
// A slower reload must not replace the rows from a newer one.
let loadTicket = 0
// The first read may show the loading copy. A later one keeps the lists.
let attempted = false
const announcedCount = ref(0)

const announcement = computed(() =>
  announcedCount.value > 0 ? t('liveRefresh.newUrgent') : '',
)

/**
 * Lists and counts fail together. A refresh that fails keeps the last
 * snapshot; the failure line is the refresher's, not an emptied list.
 */
async function loadSnapshot(isRefresh: boolean): Promise<LiveRefreshOutcome> {
  const ticket = ++loadTicket
  if (!isRefresh)
    loading.value = true
  try {
    const next = officeHomeSchema.parse(await $fetch('/api/office-home'))
    if (ticket !== loadTicket)
      return 'stale'
    snapshot.value = next
    loadError.value = false
    return 'ok'
  }
  catch {
    if (ticket !== loadTicket)
      return 'stale'
    if (!isRefresh) {
      snapshot.value = null
      loadError.value = true
    }
    return 'fail'
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

const { automatic, refreshing, updatedAt, failed, refresh } = useLiveRefresh({
  async reload() {
    const isRefresh = attempted
    attempted = true
    const [outcome] = await Promise.all([
      loadSnapshot(isRefresh),
      props.refreshDocuments(),
    ])
    return outcome
  },
  urgentKeys: () => snapshot.value ? officeHomeUrgentKeys(snapshot.value) : [],
  onAnnounce(count) {
    announcedCount.value = count
  },
})

const shownTime = computed(() =>
  updatedAt.value === null ? '' : clockLabel(updatedAt.value, props.timeZone, props.locale),
)
</script>

<template>
  <div class="mt-2">
    <!--
      The time is not a live region. Only a new urgent item is announced
      (ADR-0039). The button stays enabled so a refresh does not drop focus.
    -->
    <div
      class="flex flex-wrap items-center gap-3"
      :aria-busy="refreshing"
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        @click="refresh"
      >
        {{ t('liveRefresh.refresh') }}
      </UButton>
      <p
        v-if="updatedAt"
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
        size="xl"
        :label="t('liveRefresh.automatic')"
      />
    </div>
    <p
      class="sr-only"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ announcement }}
    </p>

    <UAlert
      v-if="loadError && !snapshot"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :description="t('officeHome.loadFailed')"
    />
    <p
      v-else-if="loading"
      class="mt-4"
      role="status"
    >
      {{ t('officeHome.loading') }}
    </p>

    <template v-else-if="snapshot">
      <section
        class="mt-6"
        :aria-labelledby="countsTitleId"
      >
        <h2
          :id="countsTitleId"
          class="mb-3 text-xl font-semibold"
        >
          {{ t('officeHome.counts') }}
        </h2>
        <dl class="grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-4">
          <div>
            <dt class="text-sm text-muted">
              {{ t('officeHome.countRides') }}
            </dt>
            <dd class="text-2xl font-semibold">
              {{ snapshot.counts.rides }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('officeHome.unassigned') }}
            </dt>
            <dd class="text-2xl font-semibold">
              {{ snapshot.counts.unassigned }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('officeHome.waiting') }}
            </dt>
            <dd class="text-2xl font-semibold">
              {{ snapshot.counts.waitingOnAcceptance }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('officeHome.inProgress') }}
            </dt>
            <dd class="text-2xl font-semibold">
              {{ snapshot.counts.inProgress }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('transfers.states.done') }}
            </dt>
            <dd class="text-2xl font-semibold">
              {{ snapshot.counts.done }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('transfers.states.no-show') }}
            </dt>
            <dd class="text-2xl font-semibold">
              {{ snapshot.counts.noShow }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              {{ t('transfers.states.cancelled') }}
            </dt>
            <dd class="text-2xl font-semibold">
              {{ snapshot.counts.cancelled }}
            </dd>
          </div>
        </dl>
      </section>

      <section
        class="mt-6"
        :aria-labelledby="unassignedTitleId"
      >
        <h2
          :id="unassignedTitleId"
          class="mb-3 text-xl font-semibold"
        >
          {{ t('officeHome.unassigned') }}
        </h2>
        <p v-if="snapshot.unassigned.length === 0">
          {{ t('officeHome.empty') }}
        </p>
        <ul
          v-else
          class="flex flex-col gap-3"
        >
          <li
            v-for="ride in snapshot.unassigned"
            :key="ride.rideId"
          >
            <article class="rounded-lg border border-default bg-default p-4 text-base">
              <h3 class="text-lg font-semibold">
                {{ ride.guestName }}
              </h3>
              <!--
                The name is the alarm. Color is not the signal (ADR-0023).
                The mark sends no mail.
              -->
              <p
                v-if="ride.unassignedAlarm"
                class="mt-1"
              >
                {{ t('officeHome.unassignedAlarm') }}
              </p>
              <OfficeHomeRideFacts
                :ride="ride"
                :time-zone="timeZone"
                :locale="locale"
              />
            </article>
          </li>
        </ul>
      </section>

      <section
        class="mt-6"
        :aria-labelledby="waitingTitleId"
      >
        <h2
          :id="waitingTitleId"
          class="mb-3 text-xl font-semibold"
        >
          {{ t('officeHome.waiting') }}
        </h2>
        <p v-if="snapshot.waitingOnAcceptance.length === 0">
          {{ t('officeHome.empty') }}
        </p>
        <ul
          v-else
          class="flex flex-col gap-3"
        >
          <li
            v-for="ride in snapshot.waitingOnAcceptance"
            :key="ride.rideId"
          >
            <article class="rounded-lg border border-default bg-default p-4 text-base">
              <h3 class="text-lg font-semibold">
                {{ ride.guestName }}
              </h3>
              <OfficeHomeRideFacts
                :ride="ride"
                :time-zone="timeZone"
                :locale="locale"
              />
            </article>
          </li>
        </ul>
      </section>

      <section
        class="mt-6"
        :aria-labelledby="progressTitleId"
      >
        <h2
          :id="progressTitleId"
          class="mb-3 text-xl font-semibold"
        >
          {{ t('officeHome.inProgress') }}
        </h2>
        <p v-if="snapshot.inProgress.length === 0">
          {{ t('officeHome.empty') }}
        </p>
        <ul
          v-else
          class="flex flex-col gap-3"
        >
          <li
            v-for="ride in snapshot.inProgress"
            :key="ride.rideId"
          >
            <article class="rounded-lg border border-default bg-default p-4 text-base">
              <h3 class="text-lg font-semibold">
                {{ ride.guestName }}
              </h3>
              <!--
                The name is the mark. Color is not the signal (ADR-0027).
                The mark sends no mail and changes no Ride command.
              -->
              <p
                v-if="ride.unclosedMark"
                class="mt-1"
              >
                {{ t('officeHome.unclosedMark') }}
              </p>
              <!--
                A stored landing starts its own clock. The unclosed mark
                stays on the scheduled pickup (ADR-0027, ADR-0030).
              -->
              <p
                v-if="ride.landingAlarm"
                class="mt-1"
              >
                {{ t('officeHome.landingAlarm') }}
              </p>
              <OfficeHomeRideFacts
                :ride="ride"
                :time-zone="timeZone"
                :locale="locale"
              />
            </article>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
