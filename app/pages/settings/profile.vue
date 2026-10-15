<script setup lang="ts">
/**
 * Profile for every Tenant role. Locale uses the existing locale save.
 * Theme uses the existing device toggle. This page does not read Tenant
 * settings, Members, invitations, or the audit log.
 */
const {
  t,
  session,
  shellError,
  chooseLocale,
} = await useSessionShell()

useHead({
  title: () => t('shell.profile'),
})

bindScreenTitle(() => t('shell.profile'))
</script>

<template>
  <section v-if="session">
    <h1
      v-if="session.role === 'driver'"
      class="mb-4 text-2xl font-semibold"
    >
      {{ t('shell.profile') }}
    </h1>
    <UAlert
      v-if="shellError"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(shellError)"
    />
    <div class="flex flex-wrap gap-2">
      <!-- Desktop pickers are small. The phone copy is xl and at least 44px. -->
      <LocaleThemeActions
        class="hidden lg:contents"
        size="sm"
        @choose="chooseLocale"
      />
      <LocaleThemeActions
        class="contents lg:hidden"
        size="xl"
        @choose="chooseLocale"
      />
    </div>
  </section>
</template>
