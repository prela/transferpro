<script setup lang="ts">
import { en, hr } from '@nuxt/ui/locale'

const { locale } = useI18n()

// Nuxt UI's own strings (selects, alerts) follow the same hr/en locale as the page.
const uiLocale = computed(() => locale.value === 'en' ? en : hr)
</script>

<template>
  <UApp :locale="uiLocale">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
