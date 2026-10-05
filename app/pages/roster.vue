<script setup lang="ts">
import type { SessionShell } from '../../shared'
import { sessionShellSchema } from '../../shared'

const { t, setLocale } = useI18n()
const requestFetch = useRequestFetch()

const pending = ref(false)
const shellError = ref<'shell.saveFailed' | 'shell.signOutFailed' | null>(null)

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
else if (!loadError.value)
  await navigateTo('/')

useHead({
  title: () => t('roster.title'),
})

const office = computed(() => session.value?.role === 'admin' || session.value?.role === 'dispatcher')

async function signOut() {
  pending.value = true
  shellError.value = null
  try {
    await $fetch('/api/auth/sign-out', { method: 'POST', body: {} })
    await navigateTo('/')
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

const loadMessage = computed(() => {
  if (shellError.value)
    return shellError.value
  if (httpStatus(loadError.value) === 403)
    return 'shell.noAccess'
  return 'shell.unavailable'
})
</script>

<template>
  <main class="mx-auto box-border w-full max-w-3xl p-4">
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
      <nav
        class="mb-4"
        :aria-label="t('shell.nav')"
      >
        <UButton
          to="/"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('roster.home') }}
        </UButton>
      </nav>
      <p class="text-sm text-muted">
        {{ t('shell.tenant') }}: {{ session.tenantName }}
      </p>
      <h1 class="mb-4 text-2xl font-semibold">
        {{ t('roster.title') }}
      </h1>
      <RosterDay
        v-if="office"
        :time-zone="session.timeZone"
      />
      <UAlert
        v-else
        color="error"
        variant="subtle"
        role="alert"
        :description="t('roster.forbidden')"
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
  </main>
</template>
