<script setup lang="ts">
import type { TenantChoice } from '../../shared'
import { tenantChoiceListSchema } from '../../shared'

/**
 * Profile menu for office staff and the Driver. The trigger shows the
 * company name, including on a phone (ADR-0056). The driver home header
 * already shows that name, so it passes showTenantOnTrigger false and the
 * page body does not repeat it. Locale and theme are one click each.
 * Sign-out and the company switch are the shared shell actions.
 */
const props = withDefaults(defineProps<{
  showTenantOnTrigger?: boolean
}>(), {
  showTenantOnTrigger: true,
})

const { session, pending, signOut } = useShellSignOut()
const { switchTenant } = useTenantSwitch()
const choices = ref<TenantChoice[]>([])

const others = computed(() =>
  choices.value.filter(choice => choice.tenantId !== session.value?.tenantId),
)

async function loadChoices() {
  if (!session.value)
    return
  try {
    const list = tenantChoiceListSchema.parse(await $fetch('/api/tenant-choices'))
    choices.value = list.choices
  }
  catch {
    choices.value = []
  }
}

onMounted(() => {
  void loadChoices()
})
</script>

<template>
  <ProfileMenu
    v-if="session"
    persist-locale
    show-profile
    :show-tenant-on-trigger="props.showTenantOnTrigger"
    :other-companies="others"
    :tenant-name="session.tenantName"
    :user-name="session.userName"
    :email="session.email"
    :role="session.role"
    :pending="pending"
    @open="loadChoices"
    @sign-out="signOut"
    @switch-tenant="switchTenant"
  />
</template>
