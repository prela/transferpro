<script setup lang="ts">
import { httpStatus } from '../transfer-day-http'

/**
 * One answer for every address. The server decides later whether a mail
 * goes out, so this page never says that the account exists.
 */
const { t, setLocale } = useI18n()

const email = ref('')
const pending = ref(false)
const sent = ref(false)
const formError = ref<'signIn.limited' | 'forgotPassword.failed' | null>(null)

useHead({
  title: () => t('forgotPassword.title'),
})

async function chooseLocale(next: 'hr' | 'en') {
  await setLocale(next)
}

async function requestReset() {
  formError.value = null
  sent.value = false
  pending.value = true
  try {
    await $fetch('/api/auth/request-password-reset', {
      method: 'POST',
      body: { email: email.value },
    })
    sent.value = true
  }
  catch (error) {
    const status = httpStatus(error) ?? 0
    formError.value = status === 429 ? 'signIn.limited' : 'forgotPassword.failed'
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <AuthFrame @choose="chooseLocale">
    <h2 class="mb-4 text-lg font-semibold text-highlighted">
      {{ t('forgotPassword.title') }}
    </h2>
    <form @submit.prevent="requestReset">
      <UFormField
        :label="t('signIn.email')"
        name="email"
        class="mb-4"
        size="xl"
      >
        <UInput
          id="forgot-email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          class="w-full [&_input]:!text-base"
        />
      </UFormField>
      <UButton
        type="submit"
        size="xl"
        block
        :disabled="pending"
      >
        {{ pending ? t('forgotPassword.submitting') : t('forgotPassword.submit') }}
      </UButton>
    </form>
    <UAlert
      v-if="sent"
      color="success"
      variant="subtle"
      role="status"
      class="mt-4"
      :description="t('forgotPassword.sent')"
      :ui="{ description: 'text-sm text-default opacity-100' }"
    />
    <UAlert
      v-if="formError"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :description="t(formError)"
      :ui="{ description: 'text-sm text-default opacity-100' }"
    />
  </AuthFrame>
</template>
