<script setup lang="ts">
import type { DisplayLocale, OfficeHome } from '../../shared'
import { officeHomeSchema } from '../../shared'

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

async function loadSnapshot(refresh = false) {
  const ticket = ++loadTicket
  // A refresh keeps the lists on screen. The first read still shows loading
  // so the empty copy does not flash.
  if (!refresh)
    loading.value = true
  loadError.value = false
  try {
    const next = officeHomeSchema.parse(await $fetch('/api/office-home'))
    if (ticket !== loadTicket)
      return
    snapshot.value = next
  }
  catch {
    if (ticket !== loadTicket)
      return
    // Lists and counts fail together. Documents are a different read.
    snapshot.value = null
    loadError.value = true
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

/**
 * One control reloads the office snapshot and the expiring-documents read.
 * There is no timer: Home does not poll.
 */
async function refresh() {
  await Promise.all([loadSnapshot(true), props.refreshDocuments()])
}

onMounted(() => {
  void loadSnapshot()
})
</script>

<template>
  <div class="mt-2">
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      :disabled="loading"
      @click="refresh"
    >
      {{ t('officeHome.refresh') }}
    </UButton>

    <UAlert
      v-if="loadError"
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
        <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
