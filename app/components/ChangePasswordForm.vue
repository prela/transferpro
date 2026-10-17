<script setup lang="ts">
import { passwordLengthLimits, passwordLengthRule } from '../../shared'
import { errorCode, httpStatus } from '../transfer-day-http'

/**
 * Current password, new password, and confirmation. Always revokes every
 * other session. There is no checkbox. A wrong current password and a
 * rule failure keep what was typed.
 */
const { t } = useI18n()
const toast = useToast()

const currentPassword = ref('')
const nextPassword = ref('')
const confirmPassword = ref('')
const pending = ref(false)
const summary = ref('')
const currentError = ref('')
const nextError = ref('')
const confirmError = ref('')

const lengthHint = computed(() => t('acceptInvite.passwordLength', {
  min: passwordLengthLimits.minPasswordLength,
  max: passwordLengthLimits.maxPasswordLength,
}))

function clearErrors() {
  summary.value = ''
  currentError.value = ''
  nextError.value = ''
  confirmError.value = ''
}

function lengthMessage(password: string): string {
  const rule = passwordLengthRule(password, passwordLengthLimits)
  if (rule === 'too-short')
    return t('acceptInvite.passwordTooShort', { min: passwordLengthLimits.minPasswordLength })
  if (rule === 'too-long')
    return t('acceptInvite.passwordTooLong', { max: passwordLengthLimits.maxPasswordLength })
  return ''
}

async function submit() {
  clearErrors()
  const lengthError = lengthMessage(nextPassword.value)
  if (lengthError !== '')
    nextError.value = lengthError
  if (nextPassword.value !== confirmPassword.value)
    confirmError.value = t('profile.passwordMismatch')
  const parts = [nextError.value, confirmError.value].filter(part => part !== '')
  if (parts.length > 0) {
    summary.value = parts.join(' ')
    return
  }
  pending.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: currentPassword.value,
        newPassword: nextPassword.value,
        revokeOtherSessions: true,
      },
    })
    currentPassword.value = ''
    nextPassword.value = ''
    confirmPassword.value = ''
    // A variable, so `role` reaches the toast the way the other saved notices do.
    // Partial<Toast> does not declare role, and an object literal is rejected.
    const saved = {
      title: t('profile.passwordChanged'),
      color: 'success' as const,
      role: 'status',
    }
    toast.add(saved)
  }
  catch (error) {
    const status = httpStatus(error) ?? 0
    const code = errorCode(error)
    if (status === 429) {
      summary.value = t('signIn.limited')
      return
    }
    if (code === 'INVALID_PASSWORD') {
      currentError.value = t('profile.currentPasswordWrong')
      summary.value = currentError.value
      return
    }
    if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
      nextError.value = lengthMessage(nextPassword.value) || t('acceptInvite.passwordRules')
      summary.value = nextError.value
      return
    }
    summary.value = t('profile.passwordChangeFailed')
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <form
    class="mt-6"
    @submit.prevent="submit"
  >
    <h2 class="mb-4 text-lg font-semibold">
      {{ t('profile.changePassword') }}
    </h2>
    <div class="mb-4">
      <label
        class="block"
        for="profile-current-password"
      >
        <span class="mb-1 block text-sm text-muted">{{ t('profile.currentPassword') }}</span>
        <UInput
          id="profile-current-password"
          v-model="currentPassword"
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          required
          class="w-full [&_input]:!text-base"
        />
      </label>
      <p
        v-if="currentError"
        id="profile-current-password-error"
        class="mt-1 text-sm"
      >
        {{ currentError }}
      </p>
    </div>
    <div class="mb-4">
      <label
        class="block"
        for="profile-new-password"
      >
        <span class="mb-1 block text-sm text-muted">{{ t('profile.newPassword') }}</span>
        <UInput
          id="profile-new-password"
          v-model="nextPassword"
          name="newPassword"
          type="password"
          autocomplete="new-password"
          required
          aria-describedby="profile-new-password-hint"
          class="w-full [&_input]:!text-base"
        />
      </label>
      <!-- Outside the label, so the field's name stays "Nova lozinka". -->
      <p
        id="profile-new-password-hint"
        class="mt-1 text-sm text-muted"
      >
        {{ lengthHint }}
      </p>
      <p
        v-if="nextError"
        id="profile-new-password-error"
        class="mt-1 text-sm"
      >
        {{ nextError }}
      </p>
    </div>
    <div class="mb-4">
      <label
        class="block"
        for="profile-confirm-password"
      >
        <span class="mb-1 block text-sm text-muted">{{ t('profile.confirmPassword') }}</span>
        <UInput
          id="profile-confirm-password"
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
        id="profile-confirm-password-error"
        class="mt-1 text-sm"
      >
        {{ confirmError }}
      </p>
    </div>
    <UButton
      type="submit"
      size="xl"
      :disabled="pending"
    >
      {{ pending ? t('profile.submitting') : t('profile.submit') }}
    </UButton>
    <UAlert
      v-if="summary"
      id="change-password-alert"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :description="summary"
      :ui="{ description: 'text-sm text-default opacity-100' }"
    />
  </form>
</template>
