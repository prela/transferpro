<script setup lang="ts">
// The office gate. A Driver and a signed-out visitor leave before this page loads.
definePageMeta({
  middleware: 'office',
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
  title: () => t('clients.title'),
})

// The middleware is the gate. If a Driver still reaches this page, the list
// does not mount, so the browser does not request the collection.
const office = computed(() => isOfficeMember(session.value?.role))
</script>

<template>
  <main class="mx-auto box-border w-full max-w-3xl p-4">
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
      <nav
        class="mb-4"
        :aria-label="t('shell.nav')"
      >
        <UButton
          to="/"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('clients.home') }}
        </UButton>
      </nav>
      <p class="text-sm text-muted">
        {{ t('shell.tenant') }}: {{ session.tenantName }}
      </p>
      <h1 class="mb-4 text-2xl font-semibold">
        {{ t('clients.title') }}
      </h1>
      <ClientList v-if="office" />
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
      <div class="mt-4 flex flex-wrap gap-2">
        <UButton
          type="button"
          size="xl"
          class="flex-1 basis-32 justify-center"
          :disabled="pending"
          @click="signOut"
        >
          {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
        </UButton>
        <LocaleThemeActions @choose="chooseLocale" />
      </div>
    </section>
  </main>
</template>
