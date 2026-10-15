<script setup lang="ts">
import type { OfficeNavGroup, OfficeNavLabels, OfficeNavLink, SessionShell } from '../../shared'
import { officeNav, officePhoneBar } from '../../shared'
import { sessionShellKey } from '../composables/session-shell'

const { t, setLocale } = useI18n()
const nuxtApp = useNuxtApp()

/** Admin sees Uprava. A Dispatcher uses this shell and does not. */
const officeRole = useState<'admin' | 'dispatcher' | null>('office-sidebar-role', () => null)

/**
 * Apply the saved Locale before this template renders. The layout is the
 * parent, so without this the sidebar is painted in the default Locale
 * and its accessible names stay there after the visible labels update.
 * Server only: awaiting the shell in the browser suspends hydration, and
 * a click on the server HTML is lost.
 */
if (import.meta.server) {
  const lookup = await readTenantSession()
  if (lookup.kind === 'member') {
    officeRole.value = isOfficeMember(lookup.session.role) ? lookup.session.role : null
    await nuxtApp.runWithContext(() => setLocale(lookup.session.locale))
  }
}

// Sign-in mounts this layout on the client, after the shell is already
// loaded, so the server read above did not run. Hydration already has the
// role. A later shell replaces a stale one before the sidebar paints:
// sign out, then sign in as the other office role, on the same page.
if (import.meta.client) {
  const { data: shell } = useNuxtData<SessionShell | null>(sessionShellKey)
  watch(shell, (next) => {
    if (!next)
      return
    officeRole.value = isOfficeMember(next.role) ? next.role : null
  }, { immediate: true })
}

const icons: Record<OfficeNavLink['id'], string> = {
  home: 'i-lucide-house',
  transfers: 'i-lucide-route',
  roster: 'i-lucide-calendar',
  clients: 'i-lucide-users',
  locations: 'i-lucide-map-pin',
  drivers: 'i-lucide-id-card',
  vehicles: 'i-lucide-car',
  audit: 'i-lucide-scroll-text',
  companySettings: 'i-lucide-settings',
}

const groups = computed(() => {
  if (!officeRole.value)
    return []
  return officeNav(officeRole.value, labels()).map(toFrameGroup)
})

const phoneLinks = computed(() =>
  officePhoneBar(officeRole.value ? officeNav(officeRole.value, labels()) : []).map(toFrameLink),
)

function labels(): OfficeNavLabels {
  return {
    operations: t('shell.groupOperations'),
    catalogs: t('shell.groupCatalogs'),
    management: t('shell.groupManagement'),
    home: t('shell.home'),
    transfers: t('transfers.nav'),
    roster: t('roster.nav'),
    clients: t('clients.nav'),
    locations: t('locations.nav'),
    drivers: t('drivers.nav'),
    vehicles: t('vehicles.nav'),
    audit: t('audit.nav'),
    companySettings: t('shell.companySettings'),
  }
}

function toFrameGroup(group: OfficeNavGroup) {
  return {
    label: group.label,
    links: group.links.map(toFrameLink),
  }
}

function toFrameLink(link: OfficeNavLink) {
  return {
    label: link.label,
    to: link.to,
    icon: icons[link.id],
    exact: link.exact,
    urgentCount: link.id === 'home' ? link.urgentCount : undefined,
  }
}
</script>

<template>
  <!--
    Panel body is only the page. The navbar title is the screen's h1.
    Search stays out of this frame.
  -->
  <AppFrame
    :groups="groups"
    :phone-links="phoneLinks"
    show-new-transfer
  >
    <template #menu>
      <OfficeUserMenu />
    </template>
    <slot />
  </AppFrame>
</template>
