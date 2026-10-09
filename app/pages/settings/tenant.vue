<script setup lang="ts">
/**
 * The Admin form for the waits and the time zone. The shared admin
 * middleware sends a Dispatcher or a Driver to Profile before this page
 * loads, so the read-only settings note is not shown here.
 */
definePageMeta({
  middleware: 'admin',
})

const {
  t,
  session,
  refresh,
  shellError,
  chooseLocale,
} = await useSessionShell()

useHead({
  title: () => t('shell.tenant'),
})
</script>

<template>
  <section v-if="session">
    <h1 class="mb-4 text-2xl font-semibold">
      {{ t('shell.tenant') }}
    </h1>
    <TenantSettings
      :is-admin="true"
      @saved="refresh()"
    />
    <UAlert
      v-if="shellError"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :description="t(shellError)"
    />
    <!--
      Locale and theme stay on signed-in pages until #124. This page is one
      of those pages, same as Home and the office screens.
    -->
    <div class="mt-4 flex flex-wrap gap-2">
      <LocaleThemeActions @choose="chooseLocale" />
    </div>
  </section>
</template>
