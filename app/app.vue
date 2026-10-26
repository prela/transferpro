<script setup lang="ts">
import { en, hr } from '@nuxt/ui/locale'

const { locale } = useI18n()

// Nuxt UI's own strings (selects, alerts) follow the same hr/en locale as the page.
const uiLocale = computed(() => locale.value === 'en' ? en : hr)

// axe requires a language on the document (WCAG 3.1.1). It follows the page locale.
useHead(computed(() => ({
  htmlAttrs: { lang: locale.value },
})))
</script>

<template>
  <UApp :locale="uiLocale">
    <TenantChangedNotice />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
