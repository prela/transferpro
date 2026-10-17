<script setup lang="ts">
import { passwordLengthLimits, passwordLengthRule } from '../../shared'
import { errorCode, httpStatus } from '../transfer-day-http'

/**
 * The token stays in the hash and is posted in the body. A success signs
 * this browser out, including when the session belonged to someone else,
 * then opens sign-in. There is no automatic sign-in.
 */
const { t, setLocale } = useI18n()
const { signOut } = useShellSignOut()

const token = ref('')
const ready = ref(false)
const invalid = ref(false)
const password = ref('')
const confirmPassword = ref('')
const pending = ref(false)
const summary = ref('')
const passwordError = ref('')
const confirmError = ref('')
const signOutFailed = ref(false)

const lengthHint = computed(() => t('acceptInvite.passwordLength', {
  min: passwordLengthLimits.minPasswordLength,
  max: passwordLengthLimits.maxPasswordLength,
}))

useHead({
  title: () => t('resetPassword.title'),
})

onMounted(() => {
  token.value = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  invalid.value = token.value === ''
  ready.value = true
})

async function chooseLocale(next: 'hr' | 'en') {
  await setLocale(next)
}

function clearErrors() {
  summary.value = ''
  passwordError.value = ''
  confirmError.value = ''
  signOutFailed.value = false
}

function lengthMessage(value: string): string {
  const rule = passwordLengthRule(value, passwordLengthLimits)
  if (rule === 'too-short')
    return t('acceptInvite.passwordTooShort', { min: passwordLengthLimits.minPasswordLength })
  if (rule === 'too-long')
    return t('acceptInvite.passwordTooLong', { max: passwordLengthLimits.maxPasswordLength })
  return ''
}

async function finishSignOut() {
  const left = await signOut('/?passwordChanged=1')
  if (!left)
    signOutFailed.value = true
}

async function submit() {
  clearErrors()
  passwordError.value = lengthMessage(password.value)
  if (password.value !== confirmPassword.value)
    confirmError.value = t('profile.passwordMismatch')
  const parts = [passwordError.value, confirmError.value].filter(part => part !== '')
  if (parts.length > 0) {
    summary.value = parts.join(' ')
    return
  }
  pending.value = true
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: { newPassword: password.value, token: token.value },
    })
    password.value = ''
    confirmPassword.value = ''
    await finishSignOut()
  }
  catch (error) {
    const status = httpStatus(error) ?? 0
    const code = errorCode(error)
    if (status === 429) {
      summary.value = t('signIn.limited')
      return
    }
    if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED') {
      invalid.value = true
      return
    }
    if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
      passwordError.value = lengthMessage(password.value) || t('acceptInvite.passwordRules')
      summary.value = passwordError.value
      return
    }
    summary.value = t('resetPassword.failed')
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <AuthFrame @choose="chooseLocale">
    <h2 class="mb-4 text-lg font-semibold text-highlighted">
      {{ t('resetPassword.title') }}
    </h2>
    <p
      v-if="!ready"
      role="status"
    >
      {{ t('resetPassword.loading') }}
    </p>
    <template v-else-if="invalid">
      <UAlert
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t('resetPassword.invalid')"
        :ui="{ description: 'text-sm text-default opacity-100' }"
      />
      <NuxtLink
        to="/forgot-password"
        class="inline-flex min-h-11 items-center text-sm text-default underline underline-offset-2"
      >
        {{ t('resetPassword.requestAgain') }}
      </NuxtLink>
    </template>
    <form
      v-else
      @submit.prevent="submit"
    >
      <div class="mb-4">
        <label
          class="block"
          for="reset-password"
        >
          <span class="mb-1 block text-sm text-muted">{{ t('profile.newPassword') }}</span>
          <UInput
            id="reset-password"
            v-model="password"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            required
            aria-describedby="reset-password-hint"
            class="w-full [&_input]:!text-base"
          />
        </label>
        <p
          id="reset-password-hint"
          class="mt-1 text-sm text-muted"
        >
          {{ lengthHint }}
        </p>
        <p
          v-if="passwordError"
          id="reset-password-error"
          class="mt-1 text-sm"
        >
          {{ passwordError }}
        </p>
      </div>
      <div class="mb-4">
        <label
          class="block"
          for="reset-confirm-password"
        >
          <span class="mb-1 block text-sm text-muted">{{ t('profile.confirmPassword') }}</span>
          <UInput
            id="reset-confirm-password"
            v-model="confirmPassword"
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full [&_input]:!text-base"
          />
        </label>
        <p
          v-if="confirmError"
          id="reset-confirm-password-error"
          class="mt-1 text-sm"
        >
          {{ confirmError }}
        </p>
      </div>
      <UButton
        type="submit"
        size="xl"
        block
        :disabled="pending"
      >
        {{ pending ? t('resetPassword.submitting') : t('resetPassword.submit') }}
      </UButton>
      <UAlert
        v-if="summary"
        id="reset-password-alert"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="summary"
        :ui="{ description: 'text-sm text-default opacity-100' }"
      />
      <UButton
        v-if="signOutFailed"
        type="button"
        size="xl"
        block
        class="mt-4"
        @click="finishSignOut"
      >
        {{ t('shell.signOut') }}
      </UButton>
    </form>
  </AuthFrame>
</template>
