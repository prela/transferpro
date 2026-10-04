<script setup lang="ts">
import type { SessionShell } from '../../shared'
import { formatInstant, sessionShellSchema, signInErrorKey } from '../../shared'

const { t, locale, setLocale } = useI18n()
const requestFetch = useRequestFetch()
const { toggle: toggleTheme } = useThemeToggle()

const email = ref('')
const password = ref('')
const pending = ref(false)
const formError = ref<'signIn.failed' | 'signIn.limited' | null>(null)
const shellError = ref<'shell.saveFailed' | 'shell.signOutFailed' | null>(null)

// 23:30 UTC is 00:30 the next day in Europe/Zagreb during standard time.
const exampleInstant = new Date('2026-01-15T23:30:00.000Z')

const { data: session, error: loadError, refresh } = await useAsyncData('session-shell', async () => {
  try {
    return sessionShellSchema.parse(await requestFetch<unknown>('/api/session'))
  }
  catch (error) {
    if (httpStatus(error) === 401)
      return null
    throw error
  }
})

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
  <main>
    <section v-if="loadError">
      <p
        class="error"
        role="alert"
      >
        {{ $t(loadMessage) }}
      </p>
      <button
        type="button"
        :disabled="pending"
        @click="signOut"
      >
        {{ pending ? $t('shell.signingOut') : $t('shell.signOut') }}
      </button>
    </section>

    <section v-else-if="session">
      <p class="label">
        {{ $t('shell.tenant') }}
      </p>
      <h1>{{ session.tenantName }}</h1>
      <p class="label">
        {{ $t('shell.exampleTime') }}
      </p>
      <time :datetime="exampleInstant.toISOString()">
        {{ formatInstant(exampleInstant, session.timeZone, session.locale) }}
      </time>
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
      <p
        v-if="shellError"
        class="error"
        role="alert"
      >
        {{ $t(shellError) }}
      </p>
      <div class="actions">
        <button
          type="button"
          :disabled="pending"
          @click="signOut"
        >
          {{ pending ? $t('shell.signingOut') : $t('shell.signOut') }}
        </button>
        <button
          type="button"
          class="secondary"
          @click="chooseLocale(locale === 'hr' ? 'en' : 'hr')"
        >
          {{ locale === 'hr' ? $t('locale.en') : $t('locale.hr') }}
        </button>
        <button
          type="button"
          class="secondary"
          @click="toggleTheme"
        >
          <span class="when-dark">{{ $t('theme.useLight') }}</span>
          <span class="when-light">{{ $t('theme.useDark') }}</span>
        </button>
      </div>
    </section>

    <section v-else>
      <h1>{{ $t('signIn.title') }}</h1>
      <p
        v-if="formError"
        class="error"
        role="alert"
      >
        {{ $t(formError) }}
      </p>
      <form @submit.prevent="signIn">
        <div class="field">
          <label for="email">{{ $t('signIn.email') }}</label>
          <input
            id="email"
            v-model="email"
            name="email"
            type="email"
            autocomplete="email"
            required
          >
        </div>
        <div class="field">
          <label for="password">{{ $t('signIn.password') }}</label>
          <input
            id="password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          >
        </div>
        <button
          type="submit"
          :disabled="pending"
        >
          {{ pending ? $t('signIn.submitting') : $t('signIn.submit') }}
        </button>
      </form>
      <div class="actions">
        <button
          type="button"
          class="secondary"
          @click="chooseLocale(locale === 'hr' ? 'en' : 'hr')"
        >
          {{ locale === 'hr' ? $t('locale.en') : $t('locale.hr') }}
        </button>
        <button
          type="button"
          class="secondary"
          @click="toggleTheme"
        >
          <span class="when-dark">{{ $t('theme.useLight') }}</span>
          <span class="when-light">{{ $t('theme.useDark') }}</span>
        </button>
      </div>
    </section>
  </main>
</template>
