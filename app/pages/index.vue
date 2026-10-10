<script setup lang="ts">
import { signInErrorKey } from '../../shared'

// Layout only. A Driver stays on the phone layout. Office staff get the
// dashboard layout. Sign-in, no-access, and the firm list stay on this page.
definePageMeta({
  middleware: 'authenticated',
})

const email = ref('')
const password = ref('')
const formError = ref<'signIn.failed' | 'signIn.limited' | null>(null)

const {
  t,
  setLocale,
  session,
  loadError,
  refresh,
  pending,
  shellError,
  signOut,
  chooseLocale,
  loadMessage,
  platformRedirect,
} = await useSessionShell()

// The middleware runs on navigation. Sign-in and sign-out on Home stay on
// this URL, so the layout has to follow the shell after those actions too.
watch(session, (next) => {
  setPageLayout(isOfficeMember(next?.role) ? 'dashboard' : 'default')
})

const documents = ref<{ reload: () => Promise<void> } | null>(null)

function refreshDocuments() {
  return documents.value?.reload() ?? Promise.resolve()
}

useHead({
  title: () => session.value?.tenantName ?? t('signIn.title'),
})

async function signIn() {
  formError.value = null
  pending.value = true
  try {
    await $fetch('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
    password.value = ''
    await refresh()
    if (platformRedirect.value)
      return
    if (!session.value) {
      formError.value = 'signIn.failed'
      return
    }
    await setLocale(session.value.locale)
  }
  catch (error) {
    formError.value = signInErrorKey(httpStatus(error) ?? 0)
  }
  finally {
    pending.value = false
  }
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}
</script>

<template>
  <!--
    Office staff fill the dashboard panel. Sign-in and Driver Home stay
    at most 28rem (ADR-0016).
  -->
  <main
    class="box-border w-full p-4"
    :class="isOfficeMember(session?.role) ? undefined : 'mx-auto max-w-md'"
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

    <section v-else-if="session">
      <p class="text-sm text-muted">
        {{ t('shell.tenant') }}
      </p>
      <h1 class="mb-4 text-2xl font-semibold">
        {{ session.tenantName }}
      </h1>
      <DriverRides
        v-if="session.role === 'driver'"
        :time-zone="session.timeZone"
        :locale="session.locale"
      />
      <!--
        Office Home is the three lists, the seven counts, and one refresh.
        The example instant is gone. Locale and theme stay on Profile.
      -->
      <OfficeHome
        v-else
        :time-zone="session.timeZone"
        :locale="session.locale"
        :refresh-documents="refreshDocuments"
      />
      <ExpiringDocuments
        ref="documents"
        :show-refresh="session.role === 'driver'"
      />
      <!--
        Tenant settings, Members, invitations, and the audit log live on
        their own screens.
      -->
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
      <!--
        Office staff reach Settings from the sidebar and the navbar menu.
        A Driver has no sidebar, so Profile opens from this phone column.
        Sign-out stays here for the same reason. Locale and theme for a
        signed-in Member are on Profile. The sign-in form below keeps both.
      -->
      <div
        v-if="session.role === 'driver'"
        class="mt-4 flex flex-wrap gap-2"
      >
        <UButton
          to="/settings"
          color="neutral"
          variant="outline"
          size="xl"
          icon="i-lucide-settings"
          class="flex-1 basis-32 justify-center"
        >
          {{ t('shell.settings') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="flex-1 basis-32 justify-center"
          :disabled="pending"
          @click="signOut"
        >
          {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
        </UButton>
      </div>
    </section>

    <section v-else>
      <h1 class="mb-4 text-2xl font-semibold">
        {{ t('signIn.title') }}
      </h1>
      <UAlert
        v-if="formError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(formError)"
      />
      <form @submit.prevent="signIn">
        <UFormField
          :label="t('signIn.email')"
          name="email"
          class="mb-4"
          size="xl"
        >
          <UInput
            id="email"
            v-model="email"
            name="email"
            type="email"
            autocomplete="email"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField
          :label="t('signIn.password')"
          name="password"
          class="mb-4"
          size="xl"
        >
          <UInput
            id="password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          size="xl"
          :disabled="pending"
        >
          {{ pending ? t('signIn.submitting') : t('signIn.submit') }}
        </UButton>
      </form>
      <div class="mt-4 flex flex-wrap gap-2">
        <LocaleThemeActions @choose="chooseLocale" />
      </div>
    </section>
  </main>
</template>
