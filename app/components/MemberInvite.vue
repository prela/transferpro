<script setup lang="ts">
import { inviteResultSchema } from '../../shared'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const email = ref('')
const role = ref<'admin' | 'dispatcher' | 'driver'>()
// Reka hides the select, so the native required check never shows a message.
const roleMissing = ref(false)
const pending = ref(false)
const failed = ref(false)
const alreadyMember = ref(false)
const emailSent = ref(true)
const inviteUrl = ref('')
const copied = ref(false)

const roleItems = computed(() => [
  { label: t('invite.roles.admin'), value: 'admin' as const },
  { label: t('invite.roles.dispatcher'), value: 'dispatcher' as const },
  { label: t('invite.roles.driver'), value: 'driver' as const },
])

// The invite control sits in the lower half of a long home page. After the
// trigger is scrolled into view it sits near the bottom of a 720px (or
// phone) viewport. USelect's default side is bottom + popper (fixed). The
// last options then sit outside the viewport; document scroll does not move
// a fixed list, so a pointer click times out. Popper + collision keeps the
// list in the viewport (it opens upward here and flips if needed).
const roleSelectContent = {
  position: 'popper' as const,
  side: 'top' as const,
  sideOffset: 8,
  align: 'start' as const,
  avoidCollisions: true,
  collisionPadding: 16,
}

async function invite() {
  // Before the role check: a missing role returns early, and a previous
  // "invite was not sent" alert would otherwise stay on screen.
  failed.value = false
  alreadyMember.value = false
  if (role.value === undefined) {
    roleMissing.value = true
    return
  }
  roleMissing.value = false
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
  catch (error) {
    const status = httpStatus(error)
    // 401 still refreshes the shell so sign-in can replace this page. The alerts
    // below still run: a signed-out submit is a failure, and 409 is already-a-member.
    if (status === 401)
      await refreshNuxtData('session-shell')
    alreadyMember.value = status === 409
    failed.value = status !== 409
  }
  finally {
    pending.value = false
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
  <section :aria-label="t('invite.title')">
    <h2 class="mt-6 mb-4 text-xl font-semibold">
      {{ t('invite.title') }}
    </h2>
    <UAlert
      v-if="alreadyMember"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t('invite.alreadyMember')"
    />
    <UAlert
      v-else-if="failed"
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
        :error="roleMissing ? t('invite.roleRequired') : false"
      >
        <USelect
          id="invite-role"
          v-model="role"
          name="role"
          :items="roleItems"
          :placeholder="t('invite.chooseRole')"
          :portal="true"
          :content="roleSelectContent"
          class="w-full"
          @update:model-value="roleMissing = false"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
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
