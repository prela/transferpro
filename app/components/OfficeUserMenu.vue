<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Office navbar menu. It names the Tenant, opens Settings, and signs out.
 * The session shell has no personal display name, so this menu does not invent one.
 * Sign-out is the shared shell action: success clears that shell and leaves the
 * device theme; failure keeps the Tenant and sets the alert already on the page.
 * Language and theme stay on Profile, and on the signed-out screen.
 */
const { t } = useI18n()
const { session, pending, signOut } = useShellSignOut()

const items = computed<DropdownMenuItem[][]>(() => {
  const tenantName = session.value?.tenantName
  if (!tenantName)
    return []
  return [
    [{ label: tenantName, type: 'label' }],
    [
      {
        label: t('shell.settings'),
        icon: 'i-lucide-settings',
        to: '/settings',
      },
      {
        label: pending.value ? t('shell.signingOut') : t('shell.signOut'),
        icon: 'i-lucide-log-out',
        disabled: pending.value,
        onSelect: () => {
          void signOut()
        },
      },
    ],
  ]
})
</script>

<template>
  <!--
    The trigger's accessible name is the Tenant. Reka sets aria-haspopup="menu"
    on this button, which is how the e2e fixture finds the menu.
  -->
  <UDropdownMenu
    v-if="session?.tenantName"
    :items="items"
    size="xl"
  >
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      size="xl"
      :label="session.tenantName"
      :disabled="pending"
    />
  </UDropdownMenu>
</template>
