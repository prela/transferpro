<script setup lang="ts">
import type { PrototypeCopy } from '../../prototype/copy'
import type { PrototypeRide } from '../../prototype/day'
import { rowAction, stateBadge, urgentLabel, warningLabels } from '../../prototype/present'

const props = defineProps<{
  copy: PrototypeCopy
  ride: PrototypeRide
  selected: boolean
}>()

const emit = defineEmits<{
  open: []
  command: []
}>()

const action = computed(() => rowAction(props.ride.state))
const badge = computed(() => stateBadge(props.ride.state))
const marks = computed(() => {
  const urgent = urgentLabel(props.copy, props.ride)
  return [urgent, ...warningLabels(props.copy, props.ride)].filter((mark): mark is string => mark !== null)
})
const closed = computed(() => props.ride.state === 'done' || props.ride.state === 'no-show' || props.ride.state === 'cancelled')
</script>

<template>
  <!--
    Desktop rows use the variant height. Phone rows stay at 48 px so the
    same component can be the Home row and the phone Transfers row.
  -->
  <div
    class="flex w-full items-center gap-2 border-b border-muted px-2 text-left hover:bg-[var(--tp-hover)] max-md:min-h-12 md:min-h-[var(--tp-row)]"
    :class="selected ? 'bg-[var(--tp-hover)]' : ''"
  >
    <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="emit('open')">
      <span class="w-12 shrink-0 tabular-nums text-sm" :class="closed ? 'text-muted' : 'text-highlighted'">
        {{ ride.time }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm" :class="closed ? 'text-muted' : ''">
          {{ ride.guest }}
          <span class="text-xs text-muted">{{ ride.passengers }}</span>
          <span v-if="ride.day !== 'today'" class="text-xs text-muted"> · {{ copy.days[ride.day] }}</span>
          <span v-else-if="ride.afterMidnight" class="text-xs text-muted"> · {{ copy.midnight }}</span>
        </span>
        <span class="block truncate text-xs text-muted">
          {{ ride.from }} → {{ ride.to }} · {{ ride.client }}
          <template v-if="ride.driver"> · {{ ride.driver }}</template>
          <template v-else> · {{ copy.unassignedDriver }}</template>
        </span>
      </span>
      <span v-if="marks.length" class="hidden shrink-0 text-xs text-warning lg:block">
        {{ marks[0] }}
      </span>
      <UBadge class="shrink-0" :color="badge.color" :variant="badge.variant" size="sm">
        {{ copy.states[ride.state] }}
      </UBadge>
    </button>
    <UButton
      v-if="action"
      type="button"
      size="xs"
      color="primary"
      variant="soft"
      class="h-11 shrink-0 md:h-7"
      :label="copy.actions[action]"
      @click="emit('command')"
    />
  </div>
</template>
