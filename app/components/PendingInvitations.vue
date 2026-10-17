<script setup lang="ts">
import type { DisplayLocale, PendingInvitation } from '../../shared'
import { displayLocaleSchema, formatInstant, pendingInvitationListSchema } from '../../shared'

const props = defineProps<{
  timeZone: string
  /** Bumped after a successful invite so the new row appears without a reload. */
  generation: number
}>()

const { t, locale } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

/** Office control: 28px on the desktop, 44px on the phone. ADR-0038. */
const controlClass = 'h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base'

const invitations = ref<PendingInvitation[]>([])
const loading = ref(false)
const loadError = ref(false)
const revokeError = ref(false)
const revokingId = ref<string | null>(null)

const displayLocale = computed<DisplayLocale>(() =>
  displayLocaleSchema.safeParse(locale.value).data ?? 'hr',
)

const phoneColumn = { class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }

const columns = computed(() => [
  { accessorKey: 'email' as const, header: t('invite.email') },
  { accessorKey: 'role' as const, header: t('invite.role'), meta: phoneColumn },
  { accessorKey: 'expiresAt' as const, header: t('members.pendingExpiry'), meta: phoneColumn },
  { id: 'revoke', header: '' },
])

function formatExpiry(instant: string): string {
  return formatInstant(new Date(instant), props.timeZone, displayLocale.value)
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const result = pendingInvitationListSchema.parse(await $fetch('/api/invitations'))
    invitations.value = result.invitations
  }
  catch {
    loadError.value = true
  }
  finally {
    loading.value = false
  }
}

async function revoke(id: string) {
  revokeError.value = false
  revokingId.value = id
  try {
    await $fetch(`/api/invitations/${id}/revoke`, { method: 'POST' })
    notifyAuditChanged()
    await load()
  }
  catch {
    revokeError.value = true
  }
  finally {
    revokingId.value = null
  }
}

watch(() => props.generation, () => {
  load()
})

onMounted(load)
</script>

<template>
  <section
    class="mt-8"
    :aria-label="t('members.pendingTitle')"
  >
    <h2 class="mb-4 text-xl font-semibold">
      {{ t('members.pendingTitle') }}
    </h2>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      :description="t('members.pendingLoadFailed')"
    />
    <p
      v-else-if="loading && invitations.length === 0"
      role="status"
    >
      {{ t('members.pendingLoading') }}
    </p>
    <template v-else>
      <UAlert
        v-if="revokeError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t('members.revokeFailed')"
      />
      <p v-if="invitations.length === 0">
        {{ t('members.pendingEmpty') }}
      </p>
      <UTable
        v-else
        :data="invitations"
        :columns="columns"
      >
        <template #email-cell="{ row }">
          {{ row.original.email }}
          <p class="mt-0.5 text-sm text-muted lg:hidden">
            {{ t(`invite.roles.${row.original.role}`) }} · {{ formatExpiry(row.original.expiresAt) }}
          </p>
        </template>
        <template #role-cell="{ row }">
          {{ t(`invite.roles.${row.original.role}`) }}
        </template>
        <template #expiresAt-cell="{ row }">
          {{ formatExpiry(row.original.expiresAt) }}
        </template>
        <template #revoke-cell="{ row }">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            size="sm"
            :class="controlClass"
            :loading="revokingId === row.original.id"
            :aria-label="t('members.revokeFor', { email: row.original.email })"
            @click="revoke(row.original.id)"
          >
            {{ t('members.revoke') }}
          </UButton>
        </template>
      </UTable>
    </template>
  </section>
</template>
