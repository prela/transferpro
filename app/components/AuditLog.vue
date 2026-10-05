<script setup lang="ts">
import type { AuditEntry, DisplayLocale, TenantRole } from '../../shared'
import { auditEntryListSchema, formatInstant } from '../../shared'

defineProps<{
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()
const { generation } = useAuditRefresh()
const titleId = useId()

const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const loadError = ref(false)
// A slower reload must not replace the rows from a newer one.
let loadTicket = 0

const columns = computed(() => [
  { accessorKey: 'occurredAt' as const, header: t('audit.when') },
  { id: 'actor', header: t('audit.who') },
  { accessorKey: 'action' as const, header: t('audit.action') },
  { id: 'subject', header: t('audit.member') },
  { id: 'detail', header: t('audit.detail') },
])

async function loadEntries() {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = false
  try {
    const next = auditEntryListSchema.parse(await $fetch('/api/audit-entries')).entries
    if (ticket !== loadTicket)
      return
    entries.value = next
  }
  catch {
    if (ticket !== loadTicket)
      return
    loadError.value = true
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

function roleLabel(role: TenantRole): string {
  return t(`invite.roles.${role}`)
}

/**
 * A platform entry stores a user id or the owner role, neither of which is a
 * member of the firm. The action sentence already says the platform did it.
 */
function isPlatformAuditAction(action: AuditEntry['action']): boolean {
  return action === 'tenant.renamed' || action === 'tenant.suspended' || action === 'tenant.reactivated'
}

function actorLabel(entry: AuditEntry): string {
  if (isPlatformAuditAction(entry.action))
    return ''
  return entry.actorName ?? t('audit.formerMember')
}

/** The role the entry kept, or the wait or time zone it changed from and to. */
function detailText(entry: AuditEntry): string {
  switch (entry.action) {
    case 'member.role_changed':
      return `${roleLabel(entry.data.from)} → ${roleLabel(entry.data.to)}`
    case 'member.invited':
    case 'member.removed':
      return roleLabel(entry.data.role)
    case 'settings.time_zone_changed':
      return `${entry.data.from} → ${entry.data.to}`
    case 'settings.airport_wait_changed':
    case 'settings.elsewhere_wait_changed':
      return t('audit.minutesChange', { from: entry.data.from, to: entry.data.to })
    case 'client.created':
      return t(`clients.kinds.${entry.data.kind}`)
    case 'client.kind_changed':
      return `${t(`clients.kinds.${entry.data.from}`)} → ${t(`clients.kinds.${entry.data.to}`)}`
    case 'client.name_changed':
      // The name stays off the row (ADR-0017). The action column says it was corrected.
      return ''
    case 'driver.created':
      // Field names only. The phone and the licence dates stay on the Driver row.
      return entry.data.fields.map(field => t(`drivers.fields.${field}`)).join(', ')
    case 'driver.field_changed':
      return t(`drivers.fields.${entry.data.field}`)
    case 'vehicle.created':
      // Field names only. The plate and the expiry dates stay on the Vehicle row.
      return entry.data.fields.map(field => t(`vehicles.fields.${field}`)).join(', ')
    case 'vehicle.field_changed':
      return t(`vehicles.fields.${entry.data.field}`)
    case 'vehicle.archived':
      return ''
    case 'location.created':
      // Field names only. The name and the address stay on the Location row.
      return entry.data.fields.map(field => t(`locations.fields.${field}`)).join(', ')
    case 'location.field_changed':
      return t(`locations.fields.${entry.data.field}`)
    case 'location.archived':
      return ''
    case 'roster.assigned':
    case 'roster.changed':
    case 'roster.cleared':
      // The field name only. The ids stay on the row; a plate or a driver name does not.
      return t('roster.vehicle')
    case 'tenant.renamed':
    case 'tenant.suspended':
    case 'tenant.reactivated':
      // The action sentence is the whole entry. The data object is empty.
      return ''
  }
}

onMounted(loadEntries)

// A settings or member change on this page bumps the counter. Refresh stays for a manual reload.
watch(generation, () => {
  loadEntries()
})
</script>

<template>
  <section>
    <h2
      :id="titleId"
      class="mt-6 mb-4 text-xl font-semibold"
    >
      {{ t('audit.title') }}
    </h2>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      :description="t('audit.loadFailed')"
    />
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('audit.loading') }}
    </p>
    <p v-else-if="entries.length === 0">
      {{ t('audit.empty') }}
    </p>
    <!-- Focusable, so a keyboard can scroll the columns a phone cannot fit. -->
    <div
      v-else
      class="overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      role="region"
      :aria-labelledby="titleId"
      tabindex="0"
    >
      <UTable
        :data="entries"
        :columns="columns"
        class="whitespace-nowrap"
      >
        <template #occurredAt-cell="{ row }">
          <time :datetime="row.original.occurredAt">
            {{ formatInstant(new Date(row.original.occurredAt), timeZone, locale) }}
          </time>
        </template>
        <template #actor-cell="{ row }">
          {{ actorLabel(row.original) }}
        </template>
        <template #action-cell="{ row }">
          {{ t(`audit.actions.${row.original.action}`) }}
        </template>
        <!-- An invite names no member: the invitee has no account yet. -->
        <template #subject-cell="{ row }">
          {{ row.original.subjectUserId === null ? '' : row.original.subjectName ?? t('audit.formerMember') }}
        </template>
        <template #detail-cell="{ row }">
          {{ detailText(row.original) }}
        </template>
      </UTable>
    </div>
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      class="mt-4"
      :disabled="loading"
      @click="loadEntries"
    >
      {{ t('audit.refresh') }}
    </UButton>
  </section>
</template>
