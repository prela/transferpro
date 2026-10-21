<script setup lang="ts">
/**
 * Profile for every Tenant role, the Driver included. The page enforces a
 * signed-in member itself, as well as the member middleware. Email is read
 * only. The password form changes this account and signs out every other
 * session. Locale uses the existing locale save. Theme uses the existing
 * device toggle. Language and theme are small pickers. This page does not
 * read Tenant settings, Members, invitations, or the audit log.
 */
definePageMeta({
  middleware: 'member',
})

const {
  t,
  session,
  loadError,
  pending,
  shellError,
  signOut,
  chooseLocale,
  loadMessage,
} = await useSessionShell()

function applyLayout() {
  setPageLayout(isOfficeMember(session.value?.role) ? 'dashboard' : 'default')
}

// Nuxt 4.6 typechecks the template against script bindings. The auto-import
// alone is not one, so the class reads this computed.
const office = computed(() => isOfficeMember(session.value?.role))

applyLayout()
watch(() => session.value?.role, applyLayout)

// The middleware is the gate. This covers a signed-out visit whose middleware
// read failed open and whose page read then found no member.
if (!session.value && !loadError.value)
  await navigateTo('/', { replace: true })

useHead({
  title: () => t('shell.profile'),
})

bindScreenTitle(() => t('shell.profile'))

const member = computed(() => session.value)
</script>

<template>
  <!--
    Office staff fill the dashboard panel. A Driver stays at most 28rem,
    the same phone column as Driver Home (ADR-0016). The office title is the
    navbar. A Driver has no frame, so the heading and the menu live here.
  -->
  <main
    class="box-border w-full p-4"
    :class="office ? undefined : 'mx-auto max-w-md'"
  >
    <section v-if="loadError">
      <UAlert
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(loadMessage)"
      />
      <UButton
        type="button"
        size="xl"
        :disabled="pending"
        @click="signOut"
      >
        {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
      </UButton>
    </section>

    <section v-else-if="member">
      <div
        v-if="member.role === 'driver'"
        class="mb-4 flex items-start justify-between gap-3"
      >
        <h1 class="text-2xl font-semibold">
          {{ t('shell.profile') }}
        </h1>
        <OfficeUserMenu />
      </div>
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(shellError)"
      />
      <label
        class="mb-4 block"
        for="profile-email"
      >
        <span class="mb-1 block text-sm text-muted">{{ t('signIn.email') }}</span>
        <UInput
          id="profile-email"
          :model-value="member.email"
          name="email"
          type="email"
          readonly
          autocomplete="email"
          class="w-full text-base"
        />
      </label>
      <p class="mb-4">
        <span class="block text-sm text-muted">{{ t('invite.role') }}</span>
        <span>{{ t(`invite.roles.${member.role}`) }}</span>
      </p>
      <p class="mb-4">
        <span class="block text-sm text-muted">{{ t('shell.tenant') }}</span>
        <span>{{ member.tenantName }}</span>
      </p>
      <ChangePasswordForm />
      <!--
        Small on every layout. The large language and theme buttons left
        this page (ADR-0038). The menu has the same choice in one click.
      -->
      <div class="flex flex-wrap gap-2">
        <LocaleThemeActions
          size="sm"
          @choose="chooseLocale"
        />
      </div>
    </section>
  </main>
</template>
