<script setup lang="ts">
import { tenantChangedKey } from '../composables/screen-tenant'

/**
 * The stale-tab refusal (issue #506). `role="alert"` announces it.
 * The plugin reloads into the active company after the message has been on screen.
 */
const { t } = useI18n()
const visible = useState(tenantChangedKey, () => false)
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-x-0 top-0 z-[80] p-4"
  >
    <div
      role="alert"
      class="mx-auto max-w-3xl"
    >
      <UAlert
        color="warning"
        variant="subtle"
        :description="t('shell.tenantChanged')"
        :ui="{ description: 'text-sm text-default opacity-100' }"
      />
    </div>
  </div>
</template>
