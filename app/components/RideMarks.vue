<script setup lang="ts">
import type { RideAttentionItem } from '../../shared'

const props = defineProps<{
  items: RideAttentionItem[]
  /** Phone row keeps marks on the second line instead of stacking a third. */
  inline?: boolean
  /** The Ride detail uses the full sentence. A row keeps the short text. */
  full?: boolean
}>()

const { t } = useI18n()

const iconFor: Record<RideAttentionItem['kind'], string> = {
  'unassigned-past-pickup': 'i-lucide-clock-alert',
  'unassigned-alarm': 'i-lucide-alarm-clock',
  'decline-alert': 'i-lucide-user-x',
  'unclosed-mark': 'i-lucide-circle-alert',
  'overlap': 'i-lucide-triangle-alert',
  'unavailable': 'i-lucide-calendar-off',
  'fully-booked': 'i-lucide-ban',
  'roster-mismatch': 'i-lucide-calendar-x',
  'expired-document': 'i-lucide-file-warning',
  'too-many-passengers': 'i-lucide-users',
}

function label(item: RideAttentionItem): string {
  if (item.kind === 'decline-alert') {
    const group = props.full ? 'transfers.attentionDetail' : 'transfers.attention'
    return t(`${group}.declined`, { driver: item.driverName ?? '' })
  }
  const group = props.full ? 'transfers.attentionDetail' : 'transfers.attention'
  const key = {
    'unassigned-past-pickup': `${group}.pastPickup`,
    'unassigned-alarm': `${group}.unassignedAlarm`,
    'unclosed-mark': `${group}.unclosed`,
    'overlap': `${group}.overlap`,
    'unavailable': `${group}.unavailable`,
    'fully-booked': `${group}.fullyBooked`,
    'roster-mismatch': `${group}.rosterMismatch`,
    'expired-document': `${group}.expiredDocument`,
    'too-many-passengers': `${group}.tooManyPassengers`,
  }[item.kind]
  return t(key)
}
</script>

<template>
  <!--
    Icon and text. Colour is not the signal (ADR-0039).
  -->
  <ul
    v-if="props.items.length > 0"
    class="flex gap-x-2 gap-y-0.5"
    :class="props.inline ? 'flex-row flex-wrap' : 'flex-col'"
  >
    <li
      v-for="(item, index) in props.items"
      :key="`${item.kind}-${item.driverName ?? index}`"
      class="flex items-center gap-1 leading-4"
      :class="props.full ? 'text-sm' : 'text-xs'"
    >
      <UIcon
        :name="iconFor[item.kind]"
        class="size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span>{{ label(item) }}</span>
    </li>
  </ul>
</template>
