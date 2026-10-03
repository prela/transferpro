<script setup lang="ts">
import { acceptErrorKey, invitationPreviewSchema, signInErrorKey } from '../../shared'

const { t, locale, setLocale } = useI18n()
const { toggle: toggleTheme } = useThemeToggle()

const invitationId = ref('')
const preview = ref<'set-password' | 'sign-in' | 'invalid' | null>(null)
const name = ref('')
const email = ref('')
const password = ref('')
const pending = ref(false)
const formError = ref<'signIn.failed' | 'signIn.limited' | 'acceptInvite.passwordRules' | 'acceptInvite.limited' | 'acceptInvite.signInTitle' | 'acceptInvite.failed' | null>(null)

useHead({
  title: () => t('acceptInvite.title'),
})

onMounted(async () => {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  invitationId.value = hash
  if (hash === '') {
    preview.value = 'invalid'
    return
  }
  try {
    const result = invitationPreviewSchema.parse(await $fetch('/api/invitations/preview', {
      method: 'POST',
      body: { invitationId: hash },
    }))
    preview.value = result.state
  }
  catch {
    preview.value = 'invalid'
  }
})

async function createAccount() {
  formError.value = null
  pending.value = true
  try {
    await $fetch('/api/invitations/accept', {
      method: 'POST',
      body: {
        invitationId: invitationId.value,
        name: name.value,
        password: password.value,
      },
    })
    password.value = ''
    await navigateTo('/')
  }
  catch (error) {
    formError.value = acceptErrorKey(httpStatus(error) ?? 0)
    if (formError.value === 'acceptInvite.signInTitle')
      preview.value = 'sign-in'
  }
  finally {
    pending.value = false
  }
}

async function signInAndAccept() {
  formError.value = null
  pending.value = true
  try {
    await $fetch('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
  }
  catch (error) {
    formError.value = signInErrorKey(httpStatus(error) ?? 0)
    pending.value = false
    return
  }
  try {
    await $fetch('/api/invitations/accept', {
      method: 'POST',
      body: { invitationId: invitationId.value },
    })
    password.value = ''
    await navigateTo('/')
  }
  catch (error) {
    formError.value = acceptErrorKey(httpStatus(error) ?? 0)
  }
  finally {
    pending.value = false
  }
}

async function chooseLocale(next: 'hr' | 'en') {
  await setLocale(next)
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
  <main>
    <h1>{{ t('acceptInvite.title') }}</h1>
    <p v-if="preview === null">
      {{ t('acceptInvite.loading') }}
    </p>
    <p
      v-else-if="preview === 'invalid'"
      class="error"
      role="alert"
    >
      {{ t('acceptInvite.invalid') }}
    </p>
    <template v-else>
      <p
        v-if="formError"
        class="error"
        role="alert"
      >
        {{ t(formError) }}
      </p>
      <p v-if="preview === 'sign-in'">
        {{ t('acceptInvite.signInTitle') }}
      </p>
      <form
        v-if="preview === 'sign-in'"
        @submit.prevent="signInAndAccept"
      >
        <div class="field">
          <label for="accept-email">{{ t('signIn.email') }}</label>
          <input
            id="accept-email"
            v-model="email"
            name="email"
            type="email"
            autocomplete="email"
            required
          >
        </div>
        <div class="field">
          <label for="accept-password">{{ t('signIn.password') }}</label>
          <input
            id="accept-password"
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
          {{ pending ? t('signIn.submitting') : t('acceptInvite.signInSubmit') }}
        </button>
      </form>
      <form
        v-else
        @submit.prevent="createAccount"
      >
        <div class="field">
          <label for="accept-name">{{ t('acceptInvite.name') }}</label>
          <input
            id="accept-name"
            v-model="name"
            name="name"
            type="text"
            autocomplete="name"
            required
          >
        </div>
        <div class="field">
          <label for="accept-new-password">{{ t('acceptInvite.password') }}</label>
          <input
            id="accept-new-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="new-password"
            required
          >
        </div>
        <button
          type="submit"
          :disabled="pending"
        >
          {{ pending ? t('acceptInvite.submitting') : t('acceptInvite.submit') }}
        </button>
      </form>
    </template>
    <div class="actions">
      <button
        type="button"
        class="secondary"
        @click="chooseLocale(locale === 'hr' ? 'en' : 'hr')"
      >
        {{ locale === 'hr' ? t('locale.en') : t('locale.hr') }}
      </button>
      <button
        type="button"
        class="secondary"
        @click="toggleTheme"
      >
        <span class="when-dark">{{ t('theme.useLight') }}</span>
        <span class="when-light">{{ t('theme.useDark') }}</span>
      </button>
    </div>
  </main>
</template>
