<script setup lang="ts">
/**
 * The audit log for an Admin. This page declares the shared admin
 * middleware, which sends a Dispatcher or a Driver Home and a signed-out
 * visitor to the sign-in form. That middleware returns without redirecting
 * when its session read is unavailable. If this page's own read then finds
 * a non-admin, leave for Home before the log mounts. Home is that
 * middleware's branch for `/audit`, not a second policy. The log loads
 * when it opens. It does not live-update from another route. Locale and
 * theme for a signed-in Member are on Profile.
 */
definePageMeta({
  middleware: 'admin',
  layout: 'dashboard',
})

const {
  t,
  session,
  loadError,
  pending,
  shellError,
  signOut,
  loadMessage,
} = await useSessionShell()

if (session.value && session.value.role !== 'admin')
  await navigateTo('/', { replace: true })

useHead({
  title: () => t('audit.title'),
})
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

    <!--
      Mount the log only for an Admin. A non-admin who reached this page
      because the middleware read failed must not request the audit endpoint.
    -->
    <section v-else-if="session?.role === 'admin'">
      <p class="text-sm text-muted">
        {{ t('shell.tenant') }}: {{ session.tenantName }}
      </p>
      <AuditLog
        :time-zone="session.timeZone"
        :locale="session.locale"
      />
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
    </section>
  </main>
</template>
