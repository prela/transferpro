<script setup lang="ts">
import type { AuditEntry, DisplayLocale, TenantRole } from '../../shared'
import { auditEntryListSchema, formatInstant } from '../../shared'

defineProps<{
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()
const titleId = useId()

const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const loadError = ref(false)

async function loadEntries() {
  loading.value = true
  loadError.value = false
  try {
    entries.value = auditEntryListSchema.parse(await $fetch('/api/audit-entries')).entries
  }
  catch {
    loadError.value = true
  }
  finally {
    loading.value = false
  }
}

function roleLabel(role: TenantRole): string {
  return t(`invite.roles.${role}`)
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
  }
}

onMounted(loadEntries)
</script>

<template>
  <section>
    <h2 :id="titleId">
      {{ t('audit.title') }}
    </h2>
    <p
      v-if="loadError"
      class="error"
      role="alert"
    >
      {{ t('audit.loadFailed') }}
    </p>
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
      class="table-scroll"
      role="region"
      :aria-labelledby="titleId"
      tabindex="0"
    >
      <table>
        <thead>
          <tr>
            <th>{{ t('audit.when') }}</th>
            <th>{{ t('audit.who') }}</th>
            <th>{{ t('audit.action') }}</th>
            <th>{{ t('audit.member') }}</th>
            <th>{{ t('audit.detail') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
          >
            <td>
              <time :datetime="entry.occurredAt">
                {{ formatInstant(new Date(entry.occurredAt), timeZone, locale) }}
              </time>
            </td>
            <td>{{ entry.actorName ?? t('audit.formerMember') }}</td>
            <td>{{ t(`audit.actions.${entry.action}`) }}</td>
            <!-- An invite names no member: the invitee has no account yet. -->
            <td>{{ entry.subjectUserId === null ? '' : entry.subjectName ?? t('audit.formerMember') }}</td>
            <td>{{ detailText(entry) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button
      type="button"
      class="secondary"
      :disabled="loading"
      @click="loadEntries"
    >
      {{ t('audit.refresh') }}
    </button>
  </section>
</template>

<style scoped>
.table-scroll {
  overflow-x: auto;
}

.table-scroll:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

th,
td {
  white-space: nowrap;
}
</style>
