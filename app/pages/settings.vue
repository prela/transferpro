<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/**
 * Settings is on `authenticated`, not `office` or `admin`: a Driver uses it.
 * `/settings` only redirects. The tab menu lists Profile until Tenant and
 * Members have routes. Office staff get the dashboard; a Driver stays in the
 * phone column. The layout is set here as well as in the middleware, because
 * a sidebar jump can drop the middleware call and this layout is not constant
 * (it cannot live in `definePageMeta`).
 */
definePageMeta({
  middleware: 'authenticated',
})

const route = useRoute()
const { t } = useI18n()
const {
  session,
  loadError,
  pending,
  signOut,
  loadMessage,
} = await useSessionShell()

function applyLayout() {
  setPageLayout(isOfficeMember(session.value?.role) ? 'dashboard' : 'default')
}

applyLayout()
watch(() => session.value?.role, applyLayout)

const path = route.path.replace(/\/$/, '') || '/'
if (!session.value && !loadError.value)
  await navigateTo('/', { replace: true })
else if (session.value && path === '/settings')
  await navigateTo('/settings/profile', { replace: true })

// One tab. Tenant and Members are later routes; do not list them yet.
const tabs = computed<NavigationMenuItem[]>(() => [{
  label: t('shell.profile'),
  icon: 'i-lucide-user',
  to: '/settings/profile',
  exact: true,
}])
</script>

<template>
  <!--
    Office staff fill the dashboard panel. A Driver stays at most 28rem,
    the same phone column as Driver Home (ADR-0016).
  -->
  <main
    class="box-border w-full p-4"
    :class="isOfficeMember(session?.role) ? undefined : 'mx-auto max-w-md'"
  >
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

    <template v-else-if="session">
      <UNavigationMenu
        as="nav"
        class="mb-4"
        color="neutral"
        highlight
        :aria-label="t('shell.settings')"
        :items="tabs"
        :ui="{ link: 'min-h-11 px-3 py-2 text-base' }"
      />
      <NuxtPage />
    </template>
  </main>
</template>
