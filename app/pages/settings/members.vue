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
  chooseLocale,
} = await useSessionShell()

useHead({
  title: () => t('members.title'),
})
</script>

<template>
  <section v-if="session">
    <h1 class="mb-4 text-2xl font-semibold">
      {{ t('members.title') }}
    </h1>
    <MemberInvite />
    <MemberList
      :is-admin="true"
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
    <!--
      Locale and theme stay on signed-in pages until #124. The invite
      failure message is switched from here, the same way Home did.
    -->
    <div class="mt-4 flex flex-wrap gap-2">
      <LocaleThemeActions @choose="chooseLocale" />
    </div>
  </section>
</template>
