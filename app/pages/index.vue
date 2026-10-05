<script setup lang="ts">
import type { SessionShell } from '../../shared'
import { formatInstant, platformShellSchema, sessionShellSchema, signInErrorKey } from '../../shared'

const { t, setLocale } = useI18n()
const requestFetch = useRequestFetch()

const email = ref('')
const password = ref('')
const pending = ref(false)
const formError = ref<'signIn.failed' | 'signIn.limited' | null>(null)
const shellError = ref<'shell.saveFailed' | 'shell.signOutFailed' | null>(null)

// 23:30 UTC is 00:30 the next day in Europe/Zagreb during standard time.
const exampleInstant = new Date('2026-01-15T23:30:00.000Z')

const platformRedirect = ref(false)

const { data: session, error: loadError, refresh } = await useAsyncData('session-shell', loadShell, {
  // A cached null would show the sign-in form to a superadmin on the next visit.
  getCachedData: () => undefined,
})

async function loadShell() {
  try {
    return sessionShellSchema.parse(await requestFetch<unknown>('/api/session'))
  }
  catch (error) {
    if (httpStatus(error) === 401)
      return null
    // 200 stays on this page. 403 then a platform session goes to the firm list.
    if (httpStatus(error) === 403 && await hasPlatformSession()) {
      platformRedirect.value = true
      await navigateTo('/admin/tenants')
      return null
    }
    throw error
  }
}

async function hasPlatformSession(): Promise<boolean> {
  try {
    platformShellSchema.parse(await requestFetch<unknown>('/api/platform/session'))
    return true
  }
  catch (error) {
    if (httpStatus(error) === 401 || httpStatus(error) === 403)
      return false
    throw error
  }
}

if (session.value)
  await setLocale(session.value.locale)

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

async function signOut() {
  pending.value = true
  shellError.value = null
  try {
    // ofetch omits Content-Type when there is no body. The auth route still
    // gives that POST a body stream, and Better Auth answers 415. An empty
    // object is application/json, which sign-out accepts.
    await $fetch('/api/auth/sign-out', { method: 'POST', body: {} })
    await refresh()
    await setLocale('hr')
  }
  catch {
    shellError.value = 'shell.signOutFailed'
  }
  finally {
    pending.value = false
  }
}

async function chooseLocale(next: SessionShell['locale']) {
  shellError.value = null
  if (!session.value) {
    await setLocale(next)
    return
  }
  try {
    await $fetch('/api/locale', {
      method: 'POST',
      body: { locale: next },
    })
    await refresh()
    await setLocale(session.value?.locale ?? next)
  }
  catch {
    shellError.value = 'shell.saveFailed'
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

// No membership is 403 (ADR-0011). Any other load failure stays a retry.
const loadMessage = computed(() => {
  if (shellError.value)
    return shellError.value
  if (httpStatus(loadError.value) === 403)
    return 'shell.noAccess'
  return 'shell.unavailable'
})
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
      <p class="text-sm text-muted">
        {{ t('shell.exampleTime') }}
      </p>
      <time
        class="mt-1 block"
        :datetime="exampleInstant.toISOString()"
      >
        {{ formatInstant(exampleInstant, session.timeZone, session.locale) }}
      </time>
      <nav
        v-if="session.role !== 'driver'"
        class="mt-4 flex flex-wrap gap-2"
        :aria-label="t('shell.nav')"
      >
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
