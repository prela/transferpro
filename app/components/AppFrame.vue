<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

interface FrameLink {
  label: string
  to: string
  icon: string
  exact?: boolean
  /** Home leaves this null until the urgent count arrives. */
  urgentCount?: number | null
}

interface FrameGroup {
  /** Omitted for the platform, which has a single item and no office group. */
  label?: string
  links: FrameLink[]
}

const props = defineProps<{
  groups: FrameGroup[]
  /** Phone bottom bar. Više opens every group the role may open. */
  phoneLinks: FrameLink[]
  showNewTransfer?: boolean
}>()

const { t } = useI18n()
const route = useRoute()
const title = useScreenTitle()
const { requestNewTransfer } = useNewTransferRequest()
const { phoneDetailOpen } = useRideDetailChrome()
const moreOpen = ref(false)

watch(() => route.fullPath, () => {
  moreOpen.value = false
})

const menuItems = computed<NavigationMenuItem[][]>(() =>
  props.groups.map((group) => {
    const links = group.links.map(toItem)
    if (!group.label)
      return links
    return [{ label: group.label, type: 'label' as const }, ...links]
  }),
)

const showFloating = computed(() =>
  props.showNewTransfer === true && (route.path === '/' || route.path === '/transfers'),
)

function toItem(link: FrameLink): NavigationMenuItem {
  return {
    'label': link.label,
    'icon': link.icon,
    'to': link.to,
    'exact': link.exact,
    // The count is part of the name once the read has arrived, including zero.
    'aria-label': typeof link.urgentCount === 'number' ? `${link.label}, ${link.urgentCount}` : link.label,
    'badge': link.urgentCount ?? undefined,
  }
}

function onPhoneNavigate() {
  moreOpen.value = false
}
</script>

<template>
  <!--
    Office and the platform share this frame (ADR-0038).
    Collapse stays in localStorage under the group's storage-key.
    xl is only the phone bar, the Više control, and the floating button.
  -->
  <UDashboardGroup
    storage="local"
    storage-key="transferpro-dashboard"
  >
    <UDashboardSidebar
      id="shell"
      collapsible
      :toggle="false"
      :ui="{ root: 'bg-[var(--tp-frame)]' }"
    >
      <template #default="{ collapsed }">
        <UNavigationMenu
          as="nav"
          orientation="vertical"
          :aria-label="t('shell.nav')"
          :collapsed="collapsed"
          :items="menuItems"
        />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel :ui="{ body: 'bg-[var(--tp-working)] pb-20 lg:pb-0' }">
      <template #header>
        <UDashboardNavbar
          :toggle="false"
          :title="title"
        >
          <template #leading>
            <UDashboardSidebarCollapse
              size="sm"
              class="hidden lg:flex"
            />
          </template>
          <template #right>
            <UButton
              v-if="showNewTransfer"
              type="button"
              size="sm"
              icon="i-lucide-plus"
              class="hidden lg:inline-flex"
              :label="t('shell.newTransfer')"
              @click="requestNewTransfer()"
            />
            <slot name="menu" />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>

  <nav
    v-if="!phoneDetailOpen"
    class="fixed inset-x-0 bottom-0 z-30 flex border-t border-default bg-[var(--tp-frame)] lg:hidden"
    :aria-label="t('shell.nav')"
  >
    <UButton
      v-for="link in phoneLinks"
      :key="link.to"
      :to="link.to"
      :exact="link.exact"
      :icon="link.icon"
      :aria-label="typeof link.urgentCount === 'number' ? `${link.label}, ${link.urgentCount}` : link.label"
      color="neutral"
      variant="ghost"
      size="xl"
      class="min-h-11 flex-1 justify-center"
    >
      {{ link.label }}
      <!-- Home leaves this empty until the urgent count arrives (ADR-0039). -->
      <span
        v-if="typeof link.urgentCount === 'number'"
        class="ms-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-inverted"
      >{{ link.urgentCount }}</span>
    </UButton>
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      size="xl"
      icon="i-lucide-menu"
      class="min-h-11 flex-1 justify-center"
      :label="t('shell.more')"
      @click="moreOpen = true"
    />
  </nav>

  <USlideover
    v-model:open="moreOpen"
    :title="t('shell.more')"
    side="bottom"
  >
    <template #body>
      <UNavigationMenu
        as="nav"
        orientation="vertical"
        :aria-label="t('shell.nav')"
        :items="menuItems"
        :ui="{ link: 'min-h-11' }"
        @click="onPhoneNavigate"
      />
    </template>
  </USlideover>

  <UButton
    v-if="showFloating && !phoneDetailOpen"
    type="button"
    size="xl"
    icon="i-lucide-plus"
    class="fixed end-4 bottom-20 z-40 min-h-12 min-w-12 lg:hidden"
    :aria-label="t('shell.newTransfer')"
    @click="requestNewTransfer()"
  />
</template>
