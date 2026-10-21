<script setup lang="ts">
import type { OfficeNavGroup, OfficeNavLabels, OfficeNavLink, SessionShell } from '../../shared'
import { officeHomeUrgentRideCount, officeNav, officePhoneBar } from '../../shared'
import { useOfficeHomeFeedOwner } from '../composables/office-home-feed'
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
  partners: 'i-lucide-handshake',
  locations: 'i-lucide-map-pin',
  drivers: 'i-lucide-id-card',
  vehicles: 'i-lucide-car',
  audit: 'i-lucide-scroll-text',
  companySettings: 'i-lucide-settings',
}

const officeHome = useOfficeHomeFeedOwner()
const urgentRideCount = computed(() =>
  officeHome.snapshot.value ? officeHomeUrgentRideCount(officeHome.snapshot.value) : null,
)

const nav = computed(() =>
  officeRole.value ? officeNav(officeRole.value, labels(), urgentRideCount.value) : [],
)

const groups = computed(() => nav.value.map(toFrameGroup))

/** The palette lists the same screens the sidebar does, without the urgent count. */
const paletteLinks = computed(() =>
  nav.value.flatMap(group => group.links).map(link => ({
    label: link.label,
    to: link.to,
    icon: icons[link.id],
  })),
)

const paletteOpen = ref(false)

const phoneLinks = computed(() => officePhoneBar(nav.value).map(toFrameLink))

function labels(): OfficeNavLabels {
  return {
    operations: t('shell.groupOperations'),
    catalogs: t('shell.groupCatalogs'),
    management: t('shell.groupManagement'),
    home: t('shell.home'),
    transfers: t('transfers.nav'),
    roster: t('roster.nav'),
    clients: t('clients.nav'),
    partners: t('partners.nav'),
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
    Ctrl/Cmd+K is the desktop palette. The phone opens it from the magnifier.
  -->
  <AppFrame
    :groups="groups"
    :phone-links="phoneLinks"
    show-new-transfer
  >
    <template #actions>
      <UButton
        type="button"
        size="xl"
        color="neutral"
        variant="ghost"
        icon="i-lucide-search"
        class="min-h-11 min-w-11 lg:hidden"
        :aria-label="t('palette.open')"
        @click="paletteOpen = true"
      />
    </template>
    <template #menu>
      <OfficeUserMenu />
    </template>
    <slot />
  </AppFrame>
  <OfficeCommandPalette
    v-model:open="paletteOpen"
    :links="paletteLinks"
  />
</template>
