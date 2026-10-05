<script setup lang="ts">
import type { PasswordLengthLimits } from '../../shared'
import { acceptErrorKey, invitationPreviewSchema, passwordLengthRule, signInErrorKey } from '../../shared'

const { t, setLocale } = useI18n()

const invitationId = ref('')
const preview = ref<'set-password' | 'sign-in' | 'invalid' | 'wrong-account' | null>(null)
const limits = ref<PasswordLengthLimits | null>(null)
// The account already signed in, when it is not the invitee.
const signedInAs = ref('')
const name = ref('')
const email = ref('')
const password = ref('')
const pending = ref(false)
const formError = ref<'signIn.failed' | 'signIn.limited' | 'acceptInvite.passwordTooShort' | 'acceptInvite.passwordTooLong' | 'acceptInvite.passwordRules' | 'acceptInvite.limited' | 'acceptInvite.signInTitle' | 'acceptInvite.failed' | 'shell.signOutFailed' | null>(null)

useHead({
  title: () => t('acceptInvite.title'),
})

const formErrorText = computed(() => {
  const key = formError.value
  const bounds = limits.value
  if (key === null)
    return ''
  if (key === 'acceptInvite.passwordTooShort' && bounds)
    return t(key, { min: bounds.minPasswordLength })
  if (key === 'acceptInvite.passwordTooLong' && bounds)
    return t(key, { max: bounds.maxPasswordLength })
  return t(key)
})

onMounted(async () => {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  invitationId.value = hash
  if (hash === '') {
    preview.value = 'invalid'
    return
  }
  await loadPreview()
})

async function loadPreview() {
  try {
    const result = invitationPreviewSchema.parse(await $fetch('/api/invitations/preview', {
      method: 'POST',
      body: { invitationId: invitationId.value },
    }))
    preview.value = result.state
    limits.value = result.state === 'set-password' ? result : null
    signedInAs.value = result.state === 'wrong-account' ? result.account : ''
  }
  catch {
    preview.value = 'invalid'
    limits.value = null
    signedInAs.value = ''
  }
}

function namedPasswordError(): 'acceptInvite.passwordTooShort' | 'acceptInvite.passwordTooLong' | null {
  const bounds = limits.value
  if (!bounds)
    return null
  const rule = passwordLengthRule(password.value, bounds)
  if (rule === 'too-short')
    return 'acceptInvite.passwordTooShort'
  if (rule === 'too-long')
    return 'acceptInvite.passwordTooLong'
  return null
}

async function createAccount() {
  formError.value = namedPasswordError()
  if (formError.value)
    return
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
    const key = acceptErrorKey(httpStatus(error) ?? 0)
    // 422 is only the length bounds. Name the bound the password missed.
    formError.value = key === 'acceptInvite.passwordRules' ? namedPasswordError() ?? key : key
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

async function signOut() {
  formError.value = null
  pending.value = true
  try {
    // ofetch omits Content-Type when there is no body. The auth route still
    // gives that POST a body stream, and Better Auth answers 415. An empty
    // object is application/json, which sign-out accepts.
    await $fetch('/api/auth/sign-out', { method: 'POST', body: {} })
    await loadPreview()
  }
  catch {
    formError.value = 'shell.signOutFailed'
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
  <main class="mx-auto box-border w-full max-w-md p-4">
    <h1 class="mb-4 text-2xl font-semibold">
      {{ t('acceptInvite.title') }}
    </h1>
    <p
      v-if="preview === null"
      role="status"
    >
      {{ t('acceptInvite.loading') }}
    </p>
    <UAlert
      v-else-if="preview === 'invalid'"
      color="error"
      variant="subtle"
      role="alert"
      :description="t('acceptInvite.invalid')"
    />
    <template v-else-if="preview === 'wrong-account'">
      <UAlert
        v-if="formError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="formErrorText"
      />
      <UAlert
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t('acceptInvite.wrongAccount', { account: signedInAs })"
      />
      <UButton
        type="button"
        size="xl"
        :disabled="pending"
        @click="signOut"
      >
        {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
      </UButton>
    </template>
    <template v-else>
      <UAlert
        v-if="formError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="formErrorText"
      />
      <p
        v-if="preview === 'sign-in'"
        class="mb-4"
      >
        {{ t('acceptInvite.signInTitle') }}
      </p>
      <form
        v-if="preview === 'sign-in'"
        @submit.prevent="signInAndAccept"
      >
        <UFormField
          :label="t('signIn.email')"
          name="email"
          class="mb-4"
          size="xl"
        >
          <UInput
            id="accept-email"
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
            id="accept-password"
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
          {{ pending ? t('signIn.submitting') : t('acceptInvite.signInSubmit') }}
        </UButton>
      </form>
      <form
        v-else
        @submit.prevent="createAccount"
      >
        <UFormField
          :label="t('acceptInvite.name')"
          name="name"
          class="mb-4"
          size="xl"
        >
          <UInput
            id="accept-name"
            v-model="name"
            name="name"
            type="text"
            autocomplete="name"
            required
            class="w-full"
          />
        </UFormField>
        <p
          v-if="limits"
          class="mb-4"
        >
          {{ t('acceptInvite.passwordLength', { min: limits.minPasswordLength, max: limits.maxPasswordLength }) }}
        </p>
        <UFormField
          :label="t('acceptInvite.password')"
          name="password"
          class="mb-4"
          size="xl"
        >
          <UInput
            id="accept-new-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="new-password"
            required
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          size="xl"
          :disabled="pending"
        >
          {{ pending ? t('acceptInvite.submitting') : t('acceptInvite.submit') }}
        </UButton>
      </form>
    </template>
    <div class="mt-4 flex flex-wrap gap-2">
      <LocaleThemeActions @choose="chooseLocale" />
    </div>
  </main>
</template>
