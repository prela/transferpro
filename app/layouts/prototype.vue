<script setup lang="ts">
import { surfaceTokens, variantParts } from '../prototype/tokens'

/**
 * Throwaway frame for #243. It does not read the tenant session, so the
 * screens open without a sign-in. Dark surface values come from `?variant=`.
 * The `.dark` class picks them, so the server and the browser render the
 * same style attribute.
 */
const route = useRoute()
const { variant } = usePrototypeQuery()
const ready = ref(false)
const driver = computed(() => route.path.startsWith('/prototype/driver'))
const style = computed(() => {
  const dark = surfaceTokens(variant.value, true)
  return {
    '--tp-dark-frame': dark.frame,
    '--tp-dark-working': dark.working,
    '--tp-dark-panel': dark.panel,
    '--tp-dark-hover': dark.hover,
    '--tp-row': `${variantParts(variant.value).row}px`,
  }
})

onMounted(() => {
  ready.value = true
})
</script>

<template>
  <div
    class="prototype-root flex h-dvh min-h-dvh flex-col bg-[var(--tp-frame)] text-default"
    :style="style"
    :data-prototype-ready="ready ? '1' : undefined"
  >
    <PrototypeTokenBar />
    <div class="relative min-h-0 flex-1">
      <PrototypeOfficeShell v-if="!driver">
        <slot />
      </PrototypeOfficeShell>
      <div v-else class="absolute inset-0 overflow-y-auto">
        <slot />
      </div>
    </div>
  </div>
</template>

<style>
/* Light surfaces are fixed. Dark ones are the variant, switched by `.dark`. */
.prototype-root {
  --ui-radius: 0.375rem;
  --ui-bg: #f8fafc;
  --ui-bg-muted: #e2e8f0;
  --ui-bg-elevated: #ffffff;
  --ui-bg-accented: #e2e8f0;
  --ui-border: #cbd5e1;
  --ui-border-muted: #cbd5e1;
  --ui-border-accented: #64748b;
  --ui-text: #0f172a;
  --ui-text-highlighted: #0f172a;
  --ui-text-toned: #475569;
  --ui-text-muted: #475569;
  --ui-text-dimmed: #475569;
  --tp-frame: #e8eef5;
  --tp-working: #f8fafc;
  --tp-panel: #ffffff;
  --tp-hover: #e2e8f0;
}

.dark .prototype-root {
  --ui-bg: var(--tp-dark-working);
  --ui-bg-muted: var(--tp-dark-hover);
  --ui-bg-elevated: var(--tp-dark-panel);
  --ui-bg-accented: var(--tp-dark-hover);
  --ui-border: #526077;
  --ui-border-muted: #526077;
  --ui-border-accented: #7a8ba3;
  --ui-text: #e2e8f0;
  --ui-text-highlighted: #e2e8f0;
  --ui-text-toned: #94a3b8;
  --ui-text-muted: #94a3b8;
  --ui-text-dimmed: #94a3b8;
  --tp-frame: var(--tp-dark-frame);
  --tp-working: var(--tp-dark-working);
  --tp-panel: var(--tp-dark-panel);
  --tp-hover: var(--tp-dark-hover);
}
</style>
