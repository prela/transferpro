<script setup lang="ts">
/**
 * The Admin invitation form plus role change and removal. The shared admin
 * middleware sends a Dispatcher or a Driver to Profile before this page
 * loads. A Dispatcher has no read-only Member list.
 */
definePageMeta({
  middleware: 'admin',
})

const {
  t,
  session,
  shellError,
} = await useSessionShell()

// The middleware is the gate. If that read failed and this one then finds
// a Dispatcher or a Driver, leave before the forms mount, so the browser
// does not request Members, invitations, role change, or removal.
if (session.value && session.value.role !== 'admin')
  await navigateTo('/settings/profile', { replace: true })

useHead({
  title: () => t('members.title'),
})
</script>

<template>
  <section v-if="session?.role === 'admin'">
    <h1 class="mb-4 text-2xl font-semibold">
      {{ t('members.title') }}
    </h1>
    <MemberInvite />
    <MemberList
      :is-admin="session.role === 'admin'"
      :current-user-id="session.userId"
    />
    <UAlert
      v-if="shellError"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :description="t(shellError)"
    />
  </section>
</template>
