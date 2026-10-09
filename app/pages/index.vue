<script setup lang="ts">
import { formatInstant, signInErrorKey } from '../../shared'

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

// 23:30 UTC is 00:30 the next day in Europe/Zagreb during standard time.
const exampleInstant = new Date('2026-01-15T23:30:00.000Z')

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
  <main class="mx-auto box-border w-full max-w-md p-4">
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
      <template v-else>
        <p class="text-sm text-muted">
          {{ t('shell.exampleTime') }}
        </p>
        <time
          class="mt-1 block"
          :datetime="exampleInstant.toISOString()"
        >
          {{ formatInstant(exampleInstant, session.timeZone, session.locale) }}
        </time>
      </template>
      <nav
        v-if="session.role !== 'driver'"
        class="mt-4 flex flex-wrap gap-2"
        :aria-label="t('shell.nav')"
      >
        <UButton
          to="/transfers"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('transfers.nav') }}
        </UButton>
        <UButton
          to="/clients"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('clients.nav') }}
        </UButton>
        <UButton
          to="/locations"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('locations.nav') }}
        </UButton>
        <UButton
          to="/drivers"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('drivers.nav') }}
        </UButton>
        <UButton
          to="/vehicles"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('vehicles.nav') }}
        </UButton>
        <UButton
          to="/roster"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('roster.nav') }}
        </UButton>
      </nav>
      <ExpiringDocuments />
      <TenantSettings
        :is-admin="session.role === 'admin'"
        @saved="refresh()"
      />
      <MemberInvite v-if="session.role === 'admin'" />
      <MemberList
        v-if="session.role !== 'driver'"
        :is-admin="session.role === 'admin'"
        :current-user-id="session.userId"
      />
      <AuditLog
        v-if="session.role === 'admin'"
        :time-zone="session.timeZone"
        :locale="session.locale"
      />
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
      <div class="mt-4 flex flex-wrap gap-2">
        <UButton
          type="button"
          size="xl"
          class="flex-1 basis-32 justify-center"
          :disabled="pending"
          @click="signOut"
        >
          {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
        </UButton>
        <LocaleThemeActions @choose="chooseLocale" />
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
