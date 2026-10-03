<script setup lang="ts">
import type { AuditEntry, DisplayLocale, TenantRole } from '../../shared'
import { auditEntryListSchema, formatInstant } from '../../shared'

defineProps<{
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()

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

/** The role the entry kept: one role, or the change from one to the other. */
function roles(entry: AuditEntry): string {
  return entry.action === 'member.role_changed'
    ? `${roleLabel(entry.data.from)} → ${roleLabel(entry.data.to)}`
    : roleLabel(entry.data.role)
}

onMounted(loadEntries)
</script>

<template>
  <section>
    <h2>{{ t('audit.title') }}</h2>
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
    <table v-else>
      <thead>
        <tr>
          <th>{{ t('audit.when') }}</th>
          <th>{{ t('audit.who') }}</th>
          <th>{{ t('audit.action') }}</th>
          <th>{{ t('audit.member') }}</th>
          <th>{{ t('audit.role') }}</th>
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
          <td>{{ roles(entry) }}</td>
        </tr>
      </tbody>
    </table>
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
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

th,
td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--line);
}

th {
  font-weight: 600;
}
</style>
