<script setup lang="ts">
/**
 * The platform uses the office frame with one item, Tvrtke (ADR-0038).
 * There is no Tenant, so there is no "+ Novi transfer" and no Moj profil.
 */
const { t, shell, pending, signOut } = await usePlatformPage()

const groups = computed(() => [{
  links: [{
    label: t('platform.title'),
    to: '/admin/tenants',
    icon: 'i-lucide-building-2',
    exact: false,
  }],
}])
</script>

<template>
  <AppFrame
    :groups="groups"
    :phone-links="groups[0]?.links ?? []"
  >
    <template #menu>
      <ProfileMenu
        v-if="shell"
        :persist-locale="false"
        :user-name="shell.userName"
        :email="shell.email"
        :pending="pending"
        @sign-out="signOut"
      />
    </template>
    <slot />
  </AppFrame>
</template>
