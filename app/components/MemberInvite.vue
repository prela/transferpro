<script setup lang="ts">
import { inviteResultSchema } from '../../shared'

const { t } = useI18n()

const email = ref('')
const role = ref<'admin' | 'dispatcher' | 'driver' | ''>('')
const pending = ref(false)
const failed = ref(false)
const emailSent = ref(true)
const inviteUrl = ref('')
const copied = ref(false)

async function invite() {
  failed.value = false
  copied.value = false
  pending.value = true
  try {
    const result = inviteResultSchema.parse(await $fetch('/api/invitations', {
      method: 'POST',
      body: { email: email.value, role: role.value },
    }))
    inviteUrl.value = result.inviteUrl
    emailSent.value = result.emailSent
    email.value = ''
    role.value = ''
  }
  catch {
    failed.value = true
  }
  finally {
    pending.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(inviteUrl.value)
    copied.value = true
  }
  catch {
    copied.value = false
  }
}
</script>

<template>
  <section>
    <h2>{{ t('invite.title') }}</h2>
    <p
      v-if="failed"
      class="error"
      role="alert"
    >
      {{ t('invite.failed') }}
    </p>
    <form @submit.prevent="invite">
      <div class="field">
        <label for="invite-email">{{ t('invite.email') }}</label>
        <input
          id="invite-email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          required
        >
      </div>
      <div class="field">
        <label for="invite-role">{{ t('invite.role') }}</label>
        <select
          id="invite-role"
          v-model="role"
          name="role"
          required
        >
          <option
            value=""
            disabled
          >
            {{ t('invite.chooseRole') }}
          </option>
          <option value="admin">
            {{ t('invite.roles.admin') }}
          </option>
          <option value="dispatcher">
            {{ t('invite.roles.dispatcher') }}
          </option>
          <option value="driver">
            {{ t('invite.roles.driver') }}
          </option>
        </select>
      </div>
      <button
        type="submit"
        :disabled="pending"
      >
        {{ pending ? t('invite.submitting') : t('invite.submit') }}
      </button>
    </form>
    <div v-if="inviteUrl">
      <p
        v-if="!emailSent"
        class="error"
        role="alert"
      >
        {{ t('invite.emailFailed') }}
      </p>
      <div class="field">
        <label for="invite-link">{{ t('invite.link') }}</label>
        <input
          id="invite-link"
          :value="inviteUrl"
          type="text"
          readonly
          spellcheck="false"
        >
      </div>
      <button
        type="button"
        class="secondary"
        @click="copyLink"
      >
        {{ copied ? t('invite.copied') : t('invite.copy') }}
      </button>
    </div>
  </section>
</template>
