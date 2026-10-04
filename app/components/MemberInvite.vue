<script setup lang="ts">
import { inviteResultSchema } from '../../shared'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const email = ref('')
const role = ref<'admin' | 'dispatcher' | 'driver'>()
const pending = ref(false)
const failed = ref(false)
const emailSent = ref(true)
const inviteUrl = ref('')
const copied = ref(false)

const roleItems = computed(() => [
  { label: t('invite.roles.admin'), value: 'admin' as const },
  { label: t('invite.roles.dispatcher'), value: 'dispatcher' as const },
  { label: t('invite.roles.driver'), value: 'driver' as const },
])

async function invite() {
  if (role.value === undefined)
    return
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
    role.value = undefined
    notifyAuditChanged()
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
    <h2 class="mt-6 mb-4 text-xl font-semibold">
      {{ t('invite.title') }}
    </h2>
    <UAlert
      v-if="failed"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t('invite.failed')"
    />
    <form @submit.prevent="invite">
      <UFormField
        :label="t('invite.email')"
        name="email"
        class="mb-4"
        size="xl"
      >
        <UInput
          id="invite-email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField
        :label="t('invite.role')"
        name="role"
        class="mb-4"
        size="xl"
      >
        <USelect
          id="invite-role"
          v-model="role"
          name="role"
          :items="roleItems"
          :placeholder="t('invite.chooseRole')"
          required
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        size="xl"
        :disabled="pending"
      >
        {{ pending ? t('invite.submitting') : t('invite.submit') }}
      </UButton>
    </form>
    <div
      v-if="inviteUrl"
      class="mt-4"
    >
      <UAlert
        v-if="!emailSent"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t('invite.emailFailed')"
      />
      <UFormField
        :label="t('invite.link')"
        name="invite-link"
        class="mb-4"
        size="xl"
      >
        <UInput
          id="invite-link"
          :model-value="inviteUrl"
          type="text"
          readonly
          spellcheck="false"
          class="w-full"
        />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        @click="copyLink"
      >
        {{ copied ? t('invite.copied') : t('invite.copy') }}
      </UButton>
    </div>
  </section>
</template>
