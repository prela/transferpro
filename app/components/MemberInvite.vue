<script setup lang="ts">
import type { InvitationMailOutcome } from '../../shared'
import { inviteResultSchema } from '../../shared'

const emit = defineEmits<{
  sent: []
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const open = ref(false)
const email = ref('')
const role = ref<'admin' | 'dispatcher' | 'driver'>()
// Reka hides the select, so the native required check never shows a message.
const roleMissing = ref(false)
const pending = ref(false)
const failed = ref(false)
const alreadyMember = ref(false)
const mail = ref<InvitationMailOutcome>('sent')
const inviteUrl = ref('')
const copied = ref(false)

/** Office control: 28px on the desktop, 44px on the phone. ADR-0038. */
const controlClass = 'h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base'

/**
 * The link is shown whatever happened to the mail. `retrying` will be sent
 * again by the outbox. `not_sent` and `stale` will not, so the Admin hands
 * the link over.
 */
const mailNotice = computed(() => {
  if (mail.value === 'retrying')
    return { color: 'warning' as const, text: t('invite.emailRetrying') }
  if (mail.value === 'stale')
    return { color: 'error' as const, text: t('invite.emailStale') }
  return { color: 'error' as const, text: t('invite.emailFailed') }
})

const roleItems = computed(() => [
  { label: t('invite.roles.admin'), value: 'admin' as const },
  { label: t('invite.roles.dispatcher'), value: 'dispatcher' as const },
  { label: t('invite.roles.driver'), value: 'driver' as const },
])

// The option list is fixed. Collision keeps every option inside the viewport.
const roleSelectContent = {
  position: 'popper' as const,
  side: 'bottom' as const,
  sideOffset: 8,
  align: 'start' as const,
  avoidCollisions: true,
  collisionPadding: 16,
}

function reset() {
  email.value = ''
  role.value = undefined
  roleMissing.value = false
  failed.value = false
  alreadyMember.value = false
  mail.value = 'sent'
  inviteUrl.value = ''
  copied.value = false
}

// Closing drops the result. Sending again is a new invitation, from a fresh modal.
watch(open, (isOpen) => {
  if (!isOpen && !pending.value)
    reset()
})

async function invite() {
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
    mail.value = result.mail
    email.value = ''
    role.value = undefined
    notifyAuditChanged()
    emit('sent')
  }
  catch (error) {
    const status = httpStatus(error)
    // 401 still refreshes the shell so sign-in can replace this page.
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
  <div class="mb-4 flex justify-end">
    <UButton
      type="button"
      size="sm"
      :class="controlClass"
      @click="open = true"
    >
      {{ t('invite.open') }}
    </UButton>
  </div>
  <UModal
    v-model:open="open"
    :title="t('invite.title')"
    :dismissible="!pending"
  >
    <template #body>
      <div>
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
        <form
          v-if="!inviteUrl"
          @submit.prevent="invite"
        >
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
            size="sm"
            :class="controlClass"
            :disabled="pending"
          >
            {{ pending ? t('invite.submitting') : t('invite.submit') }}
          </UButton>
        </form>
        <div v-else>
          <UAlert
            v-if="mail === 'sent'"
            color="success"
            variant="subtle"
            role="status"
            class="mb-4"
            :description="t('invite.sent')"
          />
          <UAlert
            v-else
            :color="mailNotice.color"
            variant="subtle"
            role="alert"
            class="mb-4"
            :description="mailNotice.text"
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
            size="sm"
            :class="controlClass"
            @click="copyLink"
          >
            {{ copied ? t('invite.copied') : t('invite.copy') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
