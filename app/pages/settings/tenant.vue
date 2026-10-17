<script setup lang="ts">
/**
 * The old Tenant tab. An Admin lands on Operativa. The middleware sends
 * every other Tenant role to Profile before this redirect.
 */
definePageMeta({
  middleware: 'admin',
})

await navigateTo('/settings', { replace: true })
</script>

<template>
  <div />
</template>
