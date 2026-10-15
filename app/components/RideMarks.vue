<script setup lang="ts">
import type { RideAttentionItem } from '../../shared'

const props = defineProps<{
  items: RideAttentionItem[]
}>()

const { t } = useI18n()

const iconFor: Record<RideAttentionItem['kind'], string> = {
  'unassigned-past-pickup': 'i-lucide-clock-alert',
  'unassigned-alarm': 'i-lucide-alarm-clock',
  'decline-alert': 'i-lucide-user-x',
  'landing-alarm': 'i-lucide-plane-landing',
  'unclosed-mark': 'i-lucide-circle-alert',
  'overlap': 'i-lucide-triangle-alert',
  'roster-mismatch': 'i-lucide-calendar-x',
  'expired-document': 'i-lucide-file-warning',
}

function label(item: RideAttentionItem): string {
  if (item.kind === 'decline-alert')
    return t('transfers.attention.declined', { driver: item.driverName ?? '' })
  const key = {
    'unassigned-past-pickup': 'transfers.attention.pastPickup',
    'unassigned-alarm': 'transfers.attention.unassignedAlarm',
    'landing-alarm': 'transfers.attention.landingAlarm',
    'unclosed-mark': 'transfers.attention.unclosed',
    'overlap': 'transfers.attention.overlap',
    'roster-mismatch': 'transfers.attention.rosterMismatch',
    'expired-document': 'transfers.attention.expiredDocument',
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
    class="flex flex-col gap-0.5"
  >
    <li
      v-for="(item, index) in props.items"
      :key="`${item.kind}-${item.driverName ?? index}`"
      class="flex items-center gap-1 text-xs leading-4"
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
