<script setup lang="ts">
/**
 * The old profile address. Every role now uses /profile. This file only
 * exists so the path still matches; the parent redirects before paint.
 */
await navigateTo('/profile', { replace: true })
</script>

<template>
  <div />
</template>
