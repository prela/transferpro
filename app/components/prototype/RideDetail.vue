<script setup lang="ts">
import type { PrototypeCopy } from '../../prototype/copy'
import type { PrototypeRide } from '../../prototype/day'
import { findRide } from '../../prototype/day'
import { money, stateBadge } from '../../prototype/present'

const props = defineProps<{
  copy: PrototypeCopy
  rideId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const toast = useToast()
const ride = computed(() => findRide(props.rideId))
const action = computed(() => ride.value ? primary(ride.value) : null)

function maps(place: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(place)}`
}

function primary(ride: PrototypeRide): { label: string, icon: string } | null {
  if (ride.state === 'unassigned')
    return { label: props.copy.actions.assign, icon: 'i-lucide-user-plus' }
  if (ride.state === 'assigned')
    return { label: props.copy.actions.confirmPhone, icon: 'i-lucide-phone' }
  if (ride.state === 'in-progress')
    return { label: props.copy.actions.done, icon: 'i-lucide-check' }
  return null
}

function ping() {
  toast.add({ title: props.copy.prototypeOnly, color: 'neutral' })
}
</script>

<template>
  <article v-if="ride" class="flex h-full min-h-0 flex-col bg-[var(--tp-panel)]">
    <header class="flex items-start justify-between gap-2 border-b border-muted px-4 py-3">
      <div>
        <p class="text-xs text-muted">
          {{ copy.detail }}
        </p>
        <h2 class="text-sm font-medium text-highlighted">
          {{ ride.guest }}
        </h2>
      </div>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-x"
        :label="copy.close"
        @click="emit('close')"
      />
    </header>
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
      <UAlert
        v-if="ride.urgent"
        color="warning"
        variant="subtle"
        icon="i-lucide-siren"
        :title="ride.urgent === 'decline' && ride.declinedBy ? `${copy.groups.decline}: ${ride.declinedBy}` : copy.groups[ride.urgent]"
        :description="copy.urgentDetail[ride.urgent]"
      />
      <UAlert
        v-for="warning in ride.warnings"
        :key="warning"
        color="warning"
        variant="outline"
        icon="i-lucide-triangle-alert"
        :title="copy.warnings[warning]"
        :description="copy.warningDetail[warning]"
      />
      <UBadge :color="stateBadge(ride.state).color" :variant="stateBadge(ride.state).variant">
        {{ copy.states[ride.state] }}
      </UBadge>
      <p class="tabular-nums text-highlighted">
        {{ ride.time }}
        <span v-if="ride.afterMidnight" class="text-xs text-muted">{{ copy.midnight }}</span>
        <span v-else-if="ride.day !== 'today'" class="text-xs text-muted">{{ copy.days[ride.day] }}</span>
      </p>
      <p v-if="ride.flight" class="font-mono text-sm">
        {{ copy.flightLanded }} {{ ride.flight }}
        <span v-if="ride.flightNote" class="font-sans text-xs text-muted">{{ ride.flightNote }}</span>
      </p>
      <p>
        <a class="text-primary underline-offset-2 hover:underline" :href="maps(ride.from)" target="_blank" rel="noopener noreferrer">{{ ride.from }}</a>
        →
        <a class="text-primary underline-offset-2 hover:underline" :href="maps(ride.to)" target="_blank" rel="noopener noreferrer">{{ ride.to }}</a>
      </p>
      <p>{{ ride.client }} <span v-if="ride.clientRef" class="text-xs text-muted">{{ ride.clientRef }}</span></p>
      <p>
        {{ ride.driver ?? copy.unassignedDriver }}
        <span v-if="ride.plate" class="font-mono text-xs">{{ ride.plate }}</span>
      </p>
      <p class="text-xs text-muted">
        {{ ride.passengers }} {{ copy.passengers }}
        <span v-if="ride.luggage"> · {{ copy.luggage }} {{ ride.luggage }}</span>
        <span v-if="ride.childSeats"> · {{ copy.seats }} {{ ride.childSeats }}</span>
      </p>
      <p v-if="ride.tabla" class="rounded-md border border-muted bg-[var(--tp-working)] px-3 py-2 text-center text-lg font-medium tracking-wide">
        {{ ride.tabla }}
      </p>
      <p v-if="ride.note">
        {{ ride.note }}
      </p>
      <p class="tabular-nums">
        {{ money(ride.price) }}
        <span class="text-xs text-muted">{{ copy.payments[ride.payment] }}</span>
      </p>
    </div>
    <footer v-if="action" class="border-t border-muted p-3">
      <UButton
        type="button"
        block
        color="primary"
        :icon="action.icon"
        :label="action.label"
        @click="ping"
      />
    </footer>
  </article>
</template>
