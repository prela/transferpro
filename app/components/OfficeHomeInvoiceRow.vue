<script setup lang="ts">
import type { DisplayLocale, OfficeHome } from '../../shared'
import { clockLabel, formatInstant, homeRowNamesTheDate, operationalDateInTimeZone } from '../../shared'

const props = defineProps<{
  ride: OfficeHome['invoiceWarnings'][number]
  timeZone: string
  locale: DisplayLocale
  operationalDate: string
  operationalDayStartHour: number
}>()

const { t } = useI18n()
const router = useRouter()

const controlClass = 'h-7 min-h-7 px-2 text-sm max-lg:h-11 max-lg:min-h-11 max-lg:px-3 max-lg:text-base'

const href = computed(() => {
  const day = operationalDateInTimeZone(props.timeZone, new Date(props.ride.pickupAt), props.operationalDayStartHour)
  return { path: '/transfers', query: { day, ride: props.ride.rideId } }
})

const when = computed(() => {
  const instant = new Date(props.ride.pickupAt)
  if (homeRowNamesTheDate(props.ride.pickupAt, props.operationalDate, props.timeZone, props.operationalDayStartHour))
    return formatInstant(instant, props.timeZone, props.locale)
  return clockLabel(instant, props.timeZone, props.locale)
})

function open() {
  void router.push(href.value)
}
</script>

<template>
  <!--
    Same two lines as an urgent Home row. Unsent is text: sending stays in
    the current tool. Failed links to the Ride, where Pokušaj ponovno runs.
  -->
  <!--
    The action is a full phrase. On a phone it wraps onto its own line so
    the guest name keeps a width and stays visible.
  -->
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
    <button
      type="button"
      class="min-w-48 flex-1 text-start text-sm"
      @click="open"
    >
      <span class="flex items-center gap-2">
        <time
          class="shrink-0 tabular-nums"
          :datetime="ride.pickupAt"
        >{{ when }}</time>
        <span class="min-w-0 truncate font-medium">{{ ride.guestName }}</span>
      </span>
      <span class="mt-0.5 block truncate text-xs">
        {{ ride.start }} → {{ ride.end }} · {{ ride.clientName }}
      </span>
    </button>
    <span
      v-if="ride.kind === 'unsent'"
      class="flex shrink-0 items-center gap-1 text-xs text-default max-lg:text-base"
    >
      <UIcon
        name="i-lucide-file-warning"
        class="size-3.5 shrink-0"
        aria-hidden="true"
      />
      {{ t('officeHome.sendFromTool') }}
    </span>
    <UButton
      v-else
      :to="href"
      color="neutral"
      variant="outline"
      size="sm"
      :class="controlClass"
      :aria-label="`${t('transfers.invoice.retry')}: ${ride.guestName}`"
    >
      {{ t('transfers.invoice.retry') }}
    </UButton>
  </div>
</template>
