<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { barePath, companySettingsRedirect, companySettingsTab } from '../../shared'

/**
 * Company settings is Admin only (ADR-0038). The page is `/settings`, with
 * Operativa and Članovi as tabs. Old addresses redirect. A Dispatcher or a
 * Driver is sent to /profile by the admin middleware on the child route, and
 * again here when that read failed open. Office staff get the dashboard.
 */
definePageMeta({
  middleware: 'authenticated',
})

const route = useRoute()
const {
  t,
  session,
  loadError,
  pending,
  refresh,
  signOut,
  shellError,
  loadMessage,
} = await useSessionShell()

function applyLayout() {
  setPageLayout(isOfficeMember(session.value?.role) ? 'dashboard' : 'default')
}

applyLayout()
watch(() => session.value?.role, applyLayout)

/**
 * Setup covers the first load. A later visit keeps this parent mounted, so
 * the guard on the next route returns the same redirect.
 */
async function leaveIfNeeded(path: string) {
  if (!session.value && !loadError.value) {
    await navigateTo('/', { replace: true })
    return
  }
  if (!session.value)
    return
  const target = companySettingsRedirect(path, session.value.role)
  if (target)
    await navigateTo(target, { replace: true })
}

await leaveIfNeeded(barePath(route.path))

onBeforeRouteUpdate((to) => {
  if (!session.value)
    return
  const target = companySettingsRedirect(barePath(to.path), session.value.role)
  if (target)
    return navigateTo(target, { replace: true })
})

const onSettings = computed(() =>
  // `/Settings` is this page. The router does not care about letter case.
  barePath(route.path).toLowerCase() === '/settings' && session.value?.role === 'admin',
)
const tab = computed(() => companySettingsTab(route.query.tab))
const pendingGeneration = ref(0)

/**
 * exact and exactQuery keep Operativa from staying current once `?tab=members`
 * is set. A prefix match would mark both links as this page.
 */
const tabs = computed<NavigationMenuItem[]>(() => [
  {
    label: t('settings.operations'),
    to: '/settings',
    exact: true,
    exactQuery: true,
  },
  {
    label: t('members.title'),
    to: { path: '/settings', query: { tab: 'members' } },
    exact: true,
    exactQuery: true,
  },
])

useHead({
  title: () => t('shell.companySettings'),
})

bindScreenTitle(() => onSettings.value ? t('shell.companySettings') : '')
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

    <template v-else-if="onSettings && session">
      <UNavigationMenu
        as="nav"
        :aria-label="t('shell.companySettings')"
        :items="tabs"
        class="mb-6 border-b border-default"
        :ui="{ link: 'h-7 min-h-7 max-lg:h-11 max-lg:min-h-11' }"
      />

      <TenantSettings
        v-if="tab === 'operations'"
        :is-admin="session.role === 'admin'"
        @saved="refresh()"
      />
      <section v-else>
        <MemberInvite @sent="pendingGeneration += 1" />
        <MemberList
          :is-admin="session.role === 'admin'"
          :current-user-id="session.userId"
        />
        <PendingInvitations
          :time-zone="session.timeZone"
          :generation="pendingGeneration"
        />
      </section>
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
    </template>
    <!-- Old addresses redirect from their own pages. This keeps that setup running. -->
    <NuxtPage />
  </main>
</template>
