<script setup lang="ts">
/**
 * The old Members address. An Admin lands on the Članovi tab. The middleware
 * sends every other Tenant role to Profile before this redirect.
 */
definePageMeta({
  middleware: 'admin',
})

await navigateTo('/settings?tab=members', { replace: true })
</script>

<template>
  <div />
</template>
