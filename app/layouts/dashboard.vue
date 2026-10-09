<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { t } = useI18n()

/**
 * Apply the saved Locale before this template renders. The layout is the
 * parent, so without this the sidebar is painted in the default language
 * and its accessible names stay there after the visible labels update.
 */
await useSessionShell()

/**
 * Office shell for an Admin or a Dispatcher. A Driver and a Superadmin never
 * use this layout. Collapse is stored in localStorage under
 * `transferpro-dashboard` (Nuxt UI appends `-sidebar-shell`), not a cookie.
 * The navbar has no title: that prop is an h1, and each page already has one.
 * The right slot is the user menu: the Tenant name, Settings, and sign-out.
 * Home is exact so it is current only on `/`. Settings is not exact: Profile
 * lives under `/settings`, and the item stays current for that section.
 * The aria-label stays when the collapsed rail hides the visible label
 * (`display: none` drops it from the name).
 * Collapse and the phone toggle are size xl: they are tapped (ADR-0016).
 */
const items = computed<NavigationMenuItem[]>(() => [
  link(t('shell.home'), 'i-lucide-house', '/', true),
  link(t('transfers.nav'), 'i-lucide-route', '/transfers'),
  link(t('clients.nav'), 'i-lucide-users', '/clients'),
  link(t('locations.nav'), 'i-lucide-map-pin', '/locations'),
  link(t('drivers.nav'), 'i-lucide-id-card', '/drivers'),
  link(t('vehicles.nav'), 'i-lucide-car', '/vehicles'),
  link(t('roster.nav'), 'i-lucide-calendar', '/roster'),
  link(t('shell.settings'), 'i-lucide-settings', '/settings'),
])

function link(label: string, icon: string, to: string, exact = false): NavigationMenuItem {
  return { label, icon, to, exact, 'aria-label': label }
}
</script>

<template>
  <!--
    Panel body is only the page. Search, inbox, charts, and toolbar actions
    are not part of this shell.
  -->
  <UDashboardGroup
    storage="local"
    storage-key="transferpro-dashboard"
  >
    <UDashboardSidebar
      id="shell"
      collapsible
      :toggle="{ size: 'xl' }"
    >
      <template #default="{ collapsed }">
        <UNavigationMenu
          as="nav"
          orientation="vertical"
          :aria-label="t('shell.nav')"
          :collapsed="collapsed"
          :items="items"
        />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <template #header>
        <UDashboardNavbar :toggle="{ size: 'xl' }">
          <template #leading>
            <UDashboardSidebarCollapse size="xl" />
          </template>
          <template #right>
            <OfficeUserMenu />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
