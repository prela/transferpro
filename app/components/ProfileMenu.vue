<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TenantChoice } from '../../shared'
import type { ShellError } from '../composables/session-shell'
import type { ThemeChoice } from '../composables/theme'
import { accountInitials } from '../../shared'
import { sessionShellKey } from '../composables/session-shell'

const props = withDefaults(defineProps<{
  /** Desktop trigger shows this beside the initials. The accessible name is always this when set. */
  tenantName?: string
  userName: string
  email?: string
  role?: 'admin' | 'dispatcher' | 'driver'
  /**
   * Office and the Driver save the locale on the user. The platform only
   * switches this screen: POST /api/locale would open a tenant session a
   * superadmin cannot mint.
   */
  persistLocale: boolean
  pending?: boolean
  /** Tenant profile. The platform has no Tenant, so it omits this item. */
  showProfile?: boolean
  /**
   * The office trigger shows the company at every width. The driver home
   * header already shows it, so that trigger stays the initials.
   */
  showTenantOnTrigger?: boolean
  /** Other working companies. The active one is not a choice. */
  otherCompanies?: readonly TenantChoice[]
}>(), {
  showTenantOnTrigger: true,
})

const emit = defineEmits<{
  signOut: []
  switchTenant: [tenantId: string]
  open: []
}>()

const { t, locale, setLocale } = useI18n()
const { choose, preference } = useThemeChoice()
const shellError = useState<ShellError>('session-shell-error', () => null)

const initials = computed(() => accountInitials(props.userName))
const accessibleName = computed(() => props.tenantName || props.userName)

// The stored choice is read after mount. Painting the check from the server
// default would mismatch a device that already picked light or dark.
const themeReady = ref(false)
onMounted(() => {
  themeReady.value = true
})

const items = computed<DropdownMenuItem[][]>(() => {
  const identity: DropdownMenuItem[] = []
  if (props.email)
    identity.push({ label: props.email, type: 'label', class: 'w-full' })
  if (props.role)
    identity.push({ label: t(`invite.roles.${props.role}`), type: 'label', class: 'w-full' })
  // The word is the label (Tvrtka / Company). The name stays its own text
  // so the shell specs can find it without the prefix.
  if (props.tenantName) {
    identity.push({ label: t('shell.tenant'), type: 'label', class: 'w-full' })
    identity.push({ label: props.tenantName, type: 'label', class: 'w-full' })
  }

  const groups: DropdownMenuItem[][] = []
  if (identity.length > 0)
    groups.push(identity)
  if (props.showProfile) {
    groups.push([{
      label: t('shell.myProfile'),
      icon: 'i-lucide-user',
      to: '/profile',
      class: 'w-full',
    }])
  }
  const others = props.otherCompanies ?? []
  if (others.length > 0) {
    groups.push([
      { label: t('shell.otherCompanies'), type: 'label', class: 'w-full' },
      ...others.map(choice => ({
        label: `${choice.tenantName}, ${t(`invite.roles.${choice.role}`)}`,
        icon: 'i-lucide-arrow-right-left',
        disabled: props.pending,
        class: 'w-full',
        onSelect: () => {
          emit('switchTenant', choice.tenantId)
        },
      })),
    ])
  }
  // One row each. A real menu item, so one click applies the choice and the
  // arrow keys reach it. The check marks the current choice.
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
      class: 'w-full',
      onSelect: () => {
        emit('signOut')
      },
    }],
  )
  return groups
})

function localeItem(code: 'hr' | 'en'): DropdownMenuItem {
  return {
    label: t(`locale.${code}Short`),
    icon: locale.value === code ? 'i-lucide-check' : undefined,
    class: 'min-w-0 flex-1 basis-0 justify-center',
    onSelect: () => {
      void pickLocale(code)
    },
  }
}

function themeItem(choice: ThemeChoice): DropdownMenuItem {
  return {
    label: t(`theme.${choice}`),
    icon: themeReady.value && preference.value === choice ? 'i-lucide-check' : undefined,
    class: 'min-w-0 flex-1 basis-0 justify-center whitespace-normal text-center',
    onSelect: () => {
      choose(choice)
    },
  }
}

function onOpen(open: boolean) {
  if (open)
    emit('open')
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
    desktop (ADR-0038). The company name is on the trigger at every width,
    except the driver home, whose header already names it (ADR-0056).
    The accessible name stays the Tenant when there is one, which is how
    the shell specs open the menu. Language is HR | EN and theme is one row,
    each choice a menu item so the keyboard and one click both work.
  -->
  <UDropdownMenu
    :items="items"
    size="sm"
    :content="{ align: 'end' }"
    :ui="{
      content: 'w-72',
      group: 'flex flex-row flex-wrap',
      item: 'min-h-11 lg:min-h-0',
    }"
    @update:open="onOpen"
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
        v-if="tenantName && showTenantOnTrigger"
        class="max-w-[58vw] whitespace-normal text-start text-xs leading-snug lg:max-w-none lg:text-sm"
      >{{ tenantName }}</span>
    </UButton>
  </UDropdownMenu>
</template>
