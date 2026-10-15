<script setup lang="ts">
import type { PrototypeCopy } from '../../prototype/copy'

defineProps<{
  copy: PrototypeCopy
  rideId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

/**
 * Below 1440 px the detail overlays the table (ADR-0038). At 1440 px and
 * wider it stands beside the list. The overlay mounts only after the
 * viewport is known, so a wide screen never keeps a full-page layer on top.
 */
const wide = ref(false)
const known = ref(false)

onMounted(() => {
  const media = window.matchMedia('(min-width: 1440px)')
  const apply = () => {
    wide.value = media.matches
  }
  apply()
  known.value = true
  media.addEventListener('change', apply)
  onScopeDispose(() => media.removeEventListener('change', apply))
})
</script>

<template>
  <div class="flex min-h-full">
    <div class="min-w-0 flex-1">
      <slot />
    </div>
    <aside
      v-if="rideId"
      data-dock="1"
      class="hidden w-[420px] shrink-0 flex-col border-l border-muted min-[1440px]:flex"
    >
      <PrototypeRideDetail :copy="copy" :ride-id="rideId" @close="emit('close')" />
    </aside>
  </div>
  <USlideover
    v-if="known && rideId && !wide"
    data-sheet="1"
    :open="true"
    :transition="false"
    :portal="false"
    side="right"
    :close="false"
    :ui="{ content: 'w-full max-w-[420px] bg-[var(--tp-panel)]', body: 'bg-[var(--tp-panel)] p-0 sm:p-0' }"
    @update:open="(open: boolean) => { if (!open) emit('close') }"
  >
    <template #body>
      <PrototypeRideDetail :copy="copy" :ride-id="rideId" @close="emit('close')" />
    </template>
  </USlideover>
</template>
