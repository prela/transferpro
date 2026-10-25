<script setup lang="ts">
import type { SessionNotice } from '../composables/session-lifetime'

/**
 * Banners for the session cap (ADR-0057). They do not block the screen
 * and they do not ask for a tap. The clock that signs the office out
 * lives in useSessionLifetime, which this component starts.
 */
const props = defineProps<{ phone?: boolean }>()
const { t } = useI18n()
const { notices } = useSessionLifetime()

const copy: Record<SessionNotice, string> = {
  office: 'session.officeEnding',
  ending: 'session.driverEnding',
  held: 'session.driverHeld',
  cap: 'session.driverCap',
}
</script>

<template>
  <div
    v-if="notices.length > 0"
    class="mb-4 flex flex-col gap-2"
    :class="props.phone ? 'mx-auto w-full max-w-md px-4 pt-4' : undefined"
  >
    <UAlert
      v-for="notice in notices"
      :key="notice"
      color="warning"
      variant="subtle"
      role="status"
      :description="t(copy[notice])"
      :ui="{ description: 'text-sm text-default opacity-100' }"
    />
  </div>
</template>
