<script setup lang="ts">
/**
 * `/settings` is the company settings page. The parent renders the tabs.
 * This child exists so the admin middleware refuses a Dispatcher or a Driver
 * on the route itself, before the form is mounted.
 */
definePageMeta({
  middleware: 'admin',
})
</script>

<template>
  <div />
</template>
