<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { PROTOTYPE_RIDES, urgentRides } from '../../prototype/day'

const { copy } = usePrototypeCopy()
const { route, to } = usePrototypeQuery()
const colorMode = useColorMode()
const { setLocale } = useI18n()
const toast = useToast()
const moreOpen = ref(false)

const urgentCount = urgentRides(PROTOTYPE_RIDES).length
const phone = computed(() => route.path === '/prototype' || route.path === '/prototype/transfers')
const detailOpen = computed(() => typeof route.query.ride === 'string')

function ping() {
  toast.add({ title: copy.value.prototypeOnly, color: 'neutral' })
}

function link(label: string, icon: string, path: string): NavigationMenuItem {
  return { label, icon, to: to(path), exact: true }
}

function soon(label: string, icon: string): NavigationMenuItem {
  return { label, icon, onSelect: ping }
}

const operations = computed<NavigationMenuItem[]>(() => [
  {
    label: copy.value.home,
    icon: 'i-lucide-house',
    to: to('/prototype'),
    exact: true,
    badge: String(urgentCount),
  },
  link(copy.value.transfers, 'i-lucide-route', '/prototype/transfers'),
  soon(copy.value.roster, 'i-lucide-calendar'),
])

const catalogs = computed<NavigationMenuItem[]>(() => [
  soon(copy.value.clients, 'i-lucide-users'),
  soon(copy.value.partners, 'i-lucide-handshake'),
  soon(copy.value.locations, 'i-lucide-map-pin'),
  soon(copy.value.drivers, 'i-lucide-id-card'),
  soon(copy.value.vehicles, 'i-lucide-car'),
  soon(copy.value.prices, 'i-lucide-receipt'),
])

const administration = computed<NavigationMenuItem[]>(() => [
  soon(copy.value.invoices, 'i-lucide-file-text'),
  soon(copy.value.audit, 'i-lucide-scroll-text'),
  soon(copy.value.settings, 'i-lucide-settings'),
])

const title = computed(() => route.path === '/prototype/transfers' ? copy.value.transfers : copy.value.home)

const profile = computed<DropdownMenuItem[][]>(() => [
  [{
    label: copy.value.email,
    type: 'label',
  }, {
    label: `${copy.value.role} · ${copy.value.driverTitle}`,
    type: 'label',
  }],
  [{
    label: copy.value.profile,
    icon: 'i-lucide-user',
    onSelect: ping,
  }],
  [{
    label: 'HR',
    icon: 'i-lucide-languages',
    onSelect: () => {
      void setLocale('hr')
    },
  }, {
    label: 'EN',
    onSelect: () => {
      void setLocale('en')
    },
  }],
  [{
    label: copy.value.light,
    icon: 'i-lucide-sun',
    onSelect: () => {
      colorMode.preference = 'light'
    },
  }, {
    label: copy.value.dark,
    icon: 'i-lucide-moon',
    onSelect: () => {
      colorMode.preference = 'dark'
    },
  }, {
    label: copy.value.system,
    icon: 'i-lucide-monitor',
    onSelect: () => {
      colorMode.preference = 'system'
    },
  }],
  [{
    label: copy.value.signOut,
    icon: 'i-lucide-log-out',
    onSelect: ping,
  }],
])
</script>

<template>
  <UDashboardGroup class="!absolute !inset-0" storage="local" storage-key="transferpro-prototype">
    <!--
      The product sidebar is desktop-only here. On a phone, Više opens the
      same groups, because a squeezed sidebar is not the phone layout.
    -->
    <UDashboardSidebar
      id="prototype-shell"
      collapsible
      resizable
      :default-size="16"
      :min-size="12"
      :max-size="22"
      :ui="{ root: 'hidden bg-[var(--tp-frame)] md:flex' }"
    >
      <template #header="{ collapsed }">
        <span v-if="!collapsed" class="truncate px-2 text-sm font-medium">Transferpro</span>
      </template>
      <template #default="{ collapsed }">
        <p v-if="!collapsed" class="px-2 pt-2 text-xs text-muted">
          {{ copy.ops }}
        </p>
        <UNavigationMenu orientation="vertical" :collapsed="collapsed" :items="operations" />
        <p v-if="!collapsed" class="px-2 pt-3 text-xs text-muted">
          {{ copy.catalogs }}
        </p>
        <UNavigationMenu orientation="vertical" :collapsed="collapsed" :items="catalogs" />
        <p v-if="!collapsed" class="px-2 pt-3 text-xs text-muted">
          {{ copy.admin }}
        </p>
        <UNavigationMenu orientation="vertical" :collapsed="collapsed" :items="administration" />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel :ui="{ body: 'bg-[var(--tp-working)] p-0 sm:p-0' }">
      <template #header>
        <UDashboardNavbar :title="title">
          <template #leading>
            <UDashboardSidebarCollapse class="max-md:hidden" />
          </template>
          <template #right>
            <UButton
              class="max-md:hidden"
              size="sm"
              icon="i-lucide-plus"
              :label="copy.newTransfer"
              @click="ping"
            />
            <UDropdownMenu :items="profile">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-circle-user"
                label="MK"
                :aria-label="copy.profile"
              />
            </UDropdownMenu>
          </template>
        </UDashboardNavbar>
      </template>
      <template #body>
        <div :class="detailOpen ? '' : 'max-md:pb-16'">
          <slot />
        </div>
      </template>
    </UDashboardPanel>
  </UDashboardGroup>

  <UButton
    v-if="phone && !detailOpen"
    class="fixed right-4 bottom-20 z-30 size-12 shadow-lg md:hidden"
    icon="i-lucide-plus"
    size="lg"
    :aria-label="copy.newTransfer"
    @click="ping"
  />

  <nav
    v-if="!detailOpen"
    class="fixed inset-x-0 bottom-0 z-30 flex border-t border-muted bg-[var(--tp-panel)] md:hidden"
    :aria-label="copy.ops"
  >
    <UButton
      class="h-12 flex-1 rounded-none"
      color="neutral"
      :variant="route.path === '/prototype' ? 'soft' : 'ghost'"
      icon="i-lucide-house"
      :label="copy.home"
      :to="to('/prototype', { ride: undefined })"
    />
    <UButton
      class="h-12 flex-1 rounded-none"
      color="neutral"
      :variant="route.path === '/prototype/transfers' ? 'soft' : 'ghost'"
      icon="i-lucide-route"
      :label="copy.transfers"
      :to="to('/prototype/transfers', { ride: undefined })"
    />
    <UButton
      class="h-12 flex-1 rounded-none"
      color="neutral"
      variant="ghost"
      icon="i-lucide-calendar"
      :label="copy.roster"
      @click="ping"
    />
    <UButton
      class="h-12 flex-1 rounded-none"
      color="neutral"
      variant="ghost"
      icon="i-lucide-ellipsis"
      :label="copy.more"
      @click="moreOpen = true"
    />
  </nav>

  <USlideover v-model:open="moreOpen" side="left" :title="copy.more" :ui="{ content: 'bg-[var(--tp-panel)]' }">
    <template #body>
      <p class="px-1 text-xs text-muted">
        {{ copy.ops }}
      </p>
      <UNavigationMenu orientation="vertical" :items="operations" />
      <p class="px-1 pt-3 text-xs text-muted">
        {{ copy.catalogs }}
      </p>
      <UNavigationMenu orientation="vertical" :items="catalogs" />
      <p class="px-1 pt-3 text-xs text-muted">
        {{ copy.admin }}
      </p>
      <UNavigationMenu orientation="vertical" :items="administration" />
    </template>
  </USlideover>
</template>
