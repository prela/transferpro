<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ThemeChoice } from '../composables/theme'
import { accountInitials } from '../../shared'
import { sessionShellKey } from '../composables/session-shell'

const props = defineProps<{
  /** Desktop trigger shows this beside the initials. The accessible name is always this when set. */
  tenantName?: string
  userName: string
  email?: string
  role?: 'admin' | 'dispatcher' | 'driver'
  /**
   * Office saves the locale on the user. The platform only switches this
   * screen: POST /api/locale would open a tenant session a superadmin cannot mint.
   */
  persistLocale: boolean
  pending?: boolean
  /** Tenant profile. The platform has no Tenant, so it omits this item. */
  showProfile?: boolean
}>()

const emit = defineEmits<{
  signOut: []
}>()

const { t, locale, setLocale } = useI18n()
const { choose, preference } = useThemeChoice()
const shellError = useState<'shell.saveFailed' | 'shell.signOutFailed' | null>('session-shell-error', () => null)

const initials = computed(() => accountInitials(props.userName))
const accessibleName = computed(() => props.tenantName || props.userName)

const items = computed<DropdownMenuItem[][]>(() => {
  const identity: DropdownMenuItem[] = []
  if (props.email)
    identity.push({ label: props.email, type: 'label' })
  if (props.role)
    identity.push({ label: t(`invite.roles.${props.role}`), type: 'label' })
  if (props.tenantName)
    identity.push({ label: props.tenantName, type: 'label' })

  const groups: DropdownMenuItem[][] = [identity]
  if (props.showProfile) {
    groups.push([{
      label: t('shell.myProfile'),
      icon: 'i-lucide-user',
      to: '/settings/profile',
    }])
  }
  groups.push(
    [
      localeItem('hr'),
      localeItem('en'),
    ],
    [
      themeItem('light'),
      themeItem('dark'),
      themeItem('system'),
    ],
    [{
      label: props.pending ? t('shell.signingOut') : t('shell.signOut'),
      icon: 'i-lucide-log-out',
      disabled: props.pending,
      onSelect: () => {
        emit('signOut')
      },
    }],
  )
  return groups
})

function localeItem(code: 'hr' | 'en'): DropdownMenuItem {
  return {
    label: t(`locale.${code}`),
    icon: locale.value === code ? 'i-lucide-check' : undefined,
    onSelect: () => {
      void pickLocale(code)
    },
  }
}

function themeItem(choice: ThemeChoice): DropdownMenuItem {
  return {
    label: t(`theme.${choice}`),
    icon: preference.value === choice ? 'i-lucide-check' : undefined,
    onSelect: () => {
      choose(choice)
    },
  }
}

async function pickLocale(next: 'hr' | 'en') {
  if (locale.value === next)
    return
  if (!props.persistLocale) {
    await setLocale(next)
    return
  }
  shellError.value = null
  try {
    await $fetch('/api/locale', { method: 'POST', body: { locale: next } })
    await refreshNuxtData(sessionShellKey)
    await setLocale(next)
  }
  catch {
    shellError.value = 'shell.saveFailed'
  }
}
</script>

<template>
  <!--
    One menu. The trigger is at least 44px on a phone and compact on the
    desktop (ADR-0038). The accessible name stays the Tenant when there is one,
    which is how the shell specs open the menu.
  -->
  <UDropdownMenu
    :items="items"
    size="sm"
    :ui="{ item: 'min-h-11 lg:min-h-0' }"
  >
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      size="sm"
      class="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
      :aria-label="accessibleName"
      :disabled="pending"
    >
      <span>{{ initials }}</span>
      <span
        v-if="tenantName"
        class="hidden lg:inline"
      >{{ tenantName }}</span>
    </UButton>
  </UDropdownMenu>
</template>
