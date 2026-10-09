<script setup lang="ts">
// The office gate. A Driver and a signed-out visitor leave before this page loads.
// Layout is declared here so an overlapping sidebar navigation cannot drop it.
definePageMeta({
  middleware: 'office',
  layout: 'dashboard',
})

const {
  t,
  session,
  loadError,
  pending,
  shellError,
  signOut,
  chooseLocale,
  loadMessage,
} = await useSessionShell({ redirectWhenSignedOut: true })

useHead({
  title: () => t('drivers.title'),
})

// The middleware is the gate. If a Driver still reaches this page, the list
// does not mount, so the browser does not request the collection.
const office = computed(() => isOfficeMember(session.value?.role))
</script>

<template>
  <main class="box-border w-full p-4">
    <section v-if="loadError">
      <UAlert
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(loadMessage)"
      />
      <UButton
        type="button"
        size="xl"
        :disabled="pending"
        @click="signOut"
      >
        {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
      </UButton>
    </section>

    <section v-else-if="session">
      <p class="text-sm text-muted">
        {{ t('shell.tenant') }}: {{ session.tenantName }}
      </p>
      <h1 class="mb-4 text-2xl font-semibold">
        {{ t('drivers.title') }}
      </h1>
      <DriverList
        v-if="office"
        :is-admin="session.role === 'admin'"
      />
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
      <div class="mt-4 flex flex-wrap gap-2">
        <LocaleThemeActions @choose="chooseLocale" />
      </div>
    </section>
  </main>
</template>
