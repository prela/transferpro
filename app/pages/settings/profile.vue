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
    <!--
      Two copies, one size each. The wrapper is what hides, because the
      actions root is display:contents and would fight a hidden class on itself.
    -->
    <div class="hidden flex-wrap gap-2 lg:flex">
      <LocaleThemeActions
        size="sm"
        @choose="chooseLocale"
      />
    </div>
    <div class="flex flex-wrap gap-2 lg:hidden">
      <LocaleThemeActions
        size="xl"
        @choose="chooseLocale"
      />
    </div>
  </section>
</template>
