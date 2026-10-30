<script setup lang="ts">
import type { DisplayLocale, OfficeHomeCountKey } from '../../shared'
import { clockLabel, formatOperationalDayStart, OFFICE_HOME_COUNT_KEYS, officeHomeBlocks, officeHomeCountPath } from '../../shared'
import { refreshSharedOfficeHome, useOfficeHomeFeed } from '../composables/office-home-feed'

const props = defineProps<{
  timeZone: string
  locale: DisplayLocale
  refreshDocuments: () => Promise<void>
}>()

const { t } = useI18n()
const {
  snapshot,
  loading,
  loadError,
  automatic,
  refreshing,
  updatedAtMs,
  failed,
  announcedCount,
  generation,
} = useOfficeHomeFeed()
const countsTitleId = useId()
const attentionTitleId = useId()
const unassignedTitleId = useId()
const waitingTitleId = useId()
const progressTitleId = useId()

const countLabel: Record<OfficeHomeCountKey, string> = {
  rides: 'officeHome.countRides',
  unassigned: 'officeHome.unassigned',
  waitingOnAcceptance: 'officeHome.waiting',
  assignedNotStarted: 'officeHome.assignedNotStarted',
  inProgress: 'officeHome.inProgress',
  handedOff: 'transfers.states.handed_off',
  done: 'transfers.states.done',
  noShow: 'transfers.states.no-show',
  cancelled: 'transfers.states.cancelled',
}

const announcement = computed(() =>
  announcedCount.value > 0 ? t('liveRefresh.newUrgent') : '',
)

const shownTime = computed(() =>
  updatedAtMs.value === null ? '' : clockLabel(new Date(updatedAtMs.value), props.timeZone, props.locale),
)

const blocks = computed(() => snapshot.value ? officeHomeBlocks(snapshot.value) : null)
const invoiceWarnings = computed(() => snapshot.value?.invoiceWarnings ?? [])
const paymentReminder = computed(() => snapshot.value?.paymentReportingReminder === true)
const attentionEmpty = computed(() =>
  blocks.value !== null
  && blocks.value.attention.length === 0
  && invoiceWarnings.value.length === 0
  && !paymentReminder.value,
)

const countLinks = computed(() => {
  const home = snapshot.value
  if (!home)
    return []
  return OFFICE_HOME_COUNT_KEYS.map(key => ({
    key,
    label: countLabel[key],
    value: home.counts[key],
    to: officeHomeCountPath(home.operationalDate, key),
  }))
})

const dayLine = computed(() => {
  const home = snapshot.value
  if (!home)
    return ''
  return t('officeHome.operationalDay', {
    date: formatOperationalDate(home.operationalDate, props.locale),
    hour: formatOperationalDayStart(home.operationalDayStartHour),
  })
})

watch(generation, (next) => {
  if (next === 0)
    return
  void props.refreshDocuments()
})

function formatOperationalDate(iso: string, locale: DisplayLocale): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day)
    return iso
  if (locale === 'hr')
    return `${Number(day)}. ${Number(month)}. ${year}.`
  return `${day}/${month}/${year}`
}
</script>

<template>
  <div class="mt-2">
    <!--
      The time is not a live region. Only a new urgent item is announced
      (ADR-0039). The button stays enabled so a refresh does not drop focus.
      The request itself belongs to the frame's loop.
    -->
    <div
      class="flex flex-wrap items-center gap-3"
      :aria-busy="refreshing"
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        class="max-lg:min-h-11 max-lg:text-base"
        @click="refreshSharedOfficeHome()"
      >
        {{ t('liveRefresh.refresh') }}
      </UButton>
      <p
        v-if="updatedAtMs !== null"
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
        class="max-lg:min-h-11"
        :label="t('liveRefresh.automatic')"
        :ui="{ label: 'max-lg:text-base' }"
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

    <template v-else-if="snapshot && blocks">
      <section
        class="mt-6"
        :aria-labelledby="countsTitleId"
      >
        <h2
          :id="countsTitleId"
          class="mb-1 text-sm font-semibold"
        >
          {{ t('officeHome.counts') }}
        </h2>
        <p class="mb-2 text-xs text-muted">
          {{ dayLine }}
        </p>
        <dl class="grid grid-cols-4 gap-2 tabular-nums">
          <div
            v-for="item in countLinks"
            :key="item.key"
          >
            <dt class="text-xs text-muted">
              {{ t(item.label) }}
            </dt>
            <dd>
              <NuxtLink
                :to="item.to"
                class="inline-flex min-h-11 items-center text-lg font-semibold underline-offset-2 hover:underline lg:min-h-7"
                :aria-label="`${t(item.label)} ${item.value}`"
              >
                {{ item.value }}
              </NuxtLink>
            </dd>
          </div>
        </dl>
      </section>

      <div class="mt-6 lg:grid lg:grid-cols-5 lg:gap-6">
        <div class="lg:col-span-3">
          <section :aria-labelledby="attentionTitleId">
            <h2
              :id="attentionTitleId"
              class="mb-3 text-sm font-semibold"
            >
              {{ t('officeHome.attention') }}
            </h2>
            <p v-if="attentionEmpty">
              {{ t('officeHome.emptyAttention') }}
            </p>
            <section
              v-for="group in blocks.attention"
              :key="group.kind"
              class="mb-4"
            >
              <h3 class="mb-1 text-xs font-medium text-muted">
                {{ t(`officeHome.groups.${group.kind}`) }} ({{ group.rides.length }})
              </h3>
              <ul class="flex flex-col gap-2">
                <li
                  v-for="ride in group.rides"
                  :key="ride.rideId"
                  class="rounded-md border border-default px-2"
                >
                  <OfficeHomeRow
                    :ride="ride"
                    :time-zone="timeZone"
                    :locale="locale"
                    :operational-date="snapshot.operationalDate"
                    :operational-day-start-hour="snapshot.operationalDayStartHour"
                  />
                </li>
              </ul>
            </section>
            <section
              v-if="paymentReminder || invoiceWarnings.length > 0"
              class="mb-4"
            >
              <!--
                Default text, not warning yellow: that yellow fails the
                light-theme contrast check.
              -->
              <h3 class="mb-1 text-xs font-medium text-default">
                {{ t('officeHome.warning') }}
              </h3>
              <p
                v-if="paymentReminder"
                class="mb-2 flex items-center gap-1 text-sm text-default"
              >
                <UIcon
                  name="i-lucide-file-warning"
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{{ t('officeHome.paymentReminder') }}</span>
              </p>
              <ul
                v-if="invoiceWarnings.length > 0"
                class="flex flex-col gap-2"
              >
                <li
                  v-for="ride in invoiceWarnings"
                  :key="ride.rideId"
                  class="rounded-md border border-default px-2"
                >
                  <OfficeHomeInvoiceRow
                    :ride="ride"
                    :time-zone="timeZone"
                    :locale="locale"
                    :operational-date="snapshot.operationalDate"
                    :operational-day-start-hour="snapshot.operationalDayStartHour"
                  />
                </li>
              </ul>
            </section>
          </section>

          <OfficeFailedMail
            :mails="snapshot.failedMails"
            :time-zone="timeZone"
            :locale="locale"
          />

          <section
            class="mt-6"
            :aria-labelledby="unassignedTitleId"
          >
            <h2
              :id="unassignedTitleId"
              class="mb-3 text-sm font-semibold"
            >
              {{ t('officeHome.unassigned') }}
            </h2>
            <p v-if="blocks.unassigned.length === 0">
              {{ t('officeHome.emptyUnassigned') }}
            </p>
            <ul
              v-else
              class="flex flex-col gap-2"
            >
              <li
                v-for="ride in blocks.unassigned"
                :key="ride.rideId"
                class="rounded-md border border-default px-2"
              >
                <OfficeHomeRow
                  :ride="ride"
                  :time-zone="timeZone"
                  :locale="locale"
                  :operational-date="snapshot.operationalDate"
                  :operational-day-start-hour="snapshot.operationalDayStartHour"
                />
              </li>
            </ul>
          </section>

          <section
            class="mt-6"
            :aria-labelledby="waitingTitleId"
          >
            <h2
              :id="waitingTitleId"
              class="mb-3 text-sm font-semibold"
            >
              {{ t('officeHome.waiting') }}
            </h2>
            <p v-if="blocks.waitingOnAcceptance.length === 0">
              {{ t('officeHome.emptyWaiting') }}
            </p>
            <ul
              v-else
              class="flex flex-col gap-2"
            >
              <li
                v-for="ride in blocks.waitingOnAcceptance"
                :key="ride.rideId"
                class="rounded-md border border-default px-2"
              >
                <OfficeHomeRow
                  :ride="ride"
                  :time-zone="timeZone"
                  :locale="locale"
                  :operational-date="snapshot.operationalDate"
                  :operational-day-start-hour="snapshot.operationalDayStartHour"
                />
              </li>
            </ul>
          </section>
        </div>

        <div class="lg:col-span-2">
          <section
            class="mt-6 lg:mt-0"
            :aria-labelledby="progressTitleId"
          >
            <h2
              :id="progressTitleId"
              class="mb-3 text-sm font-semibold"
            >
              {{ t('officeHome.inProgress') }}
            </h2>
            <p v-if="blocks.inProgress.length === 0">
              {{ t('officeHome.emptyInProgress') }}
            </p>
            <ul
              v-else
              class="flex flex-col gap-2"
            >
              <li
                v-for="ride in blocks.inProgress"
                :key="ride.rideId"
                class="rounded-md border border-default px-2"
              >
                <OfficeHomeRow
                  :ride="ride"
                  :time-zone="timeZone"
                  :locale="locale"
                  :operational-date="snapshot.operationalDate"
                  :operational-day-start-hour="snapshot.operationalDayStartHour"
                />
              </li>
            </ul>
          </section>
          <slot name="documents" />
        </div>
      </div>
    </template>
    <!--
      The same slot while the snapshot is missing, so a failed office read
      still shows expiring documents (ADR-0024).
    -->
    <div
      v-if="!snapshot"
      class="lg:grid lg:grid-cols-5 lg:gap-6"
    >
      <div class="lg:col-span-2 lg:col-start-4">
        <slot name="documents" />
      </div>
    </div>
  </div>
</template>
