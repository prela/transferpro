<script setup lang="ts">
/**
 * Office profile menu. The trigger is the initials plus the Tenant name
 * on the desktop, and the initials on a phone. Locale and theme are one
 * click each (ADR-0038, ADR-0040). Sign-out is the shared shell action.
 */
const { session, pending, signOut } = useShellSignOut()
</script>

<template>
  <ProfileMenu
    v-if="session"
    persist-locale
    show-profile
    :tenant-name="session.tenantName"
    :user-name="session.userName"
    :email="session.email"
    :role="session.role"
    :pending="pending"
    @sign-out="signOut"
  />
</template>
