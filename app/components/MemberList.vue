<script setup lang="ts">
import type { Member } from '../../shared'
import { memberListSchema } from '../../shared'

defineProps<{
  isAdmin: boolean
}>()

const { t } = useI18n()

const members = ref<Member[]>([])
const loading = ref(false)
const loadError = ref(false)
const operationError = ref<string | null>(null)
const confirmingRemove = ref<string | null>(null)

async function loadMembers() {
  loading.value = true
  loadError.value = false
  operationError.value = null
  try {
    const result = memberListSchema.parse(await $fetch('/api/members'))
    members.value = result.members
  }
  catch {
    loadError.value = true
  }
  finally {
    loading.value = false
  }
}

async function changeRole(userId: string, newRole: Member['role']) {
  operationError.value = null
  try {
    await $fetch(`/api/members/${userId}/role`, {
      method: 'PATCH',
      body: { role: newRole },
    })
    await loadMembers()
  }
  catch (error) {
    operationError.value = isLastAdminError(error)
      ? 'members.lastAdmin'
      : 'members.changeRoleFailed'
  }
}

async function removeMember(userId: string) {
  operationError.value = null
  try {
    await $fetch(`/api/members/${userId}`, {
      method: 'DELETE',
    })
    confirmingRemove.value = null
    await loadMembers()
  }
  catch (error) {
    confirmingRemove.value = null
    operationError.value = isLastAdminError(error)
      ? 'members.lastAdmin'
      : 'members.removeFailed'
  }
}

function isLastAdminError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null)
    return false
  return ('statusCode' in error && error.statusCode === 409)
    || ('status' in error && error.status === 409)
}

onMounted(() => {
  loadMembers()
})
</script>

<template>
  <section>
    <h2>{{ t('members.title') }}</h2>
    <p
      v-if="loadError"
      class="error"
      role="alert"
    >
      {{ t('members.loadFailed') }}
    </p>
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('members.loading') }}
    </p>
    <div v-else>
      <p
        v-if="operationError"
        class="error"
        role="alert"
      >
        {{ t(operationError) }}
      </p>
      <table v-if="members.length > 0">
        <thead>
          <tr>
            <th>{{ t('members.name') }}</th>
            <th>{{ t('members.role') }}</th>
            <th v-if="isAdmin" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="member in members"
            :key="member.userId"
          >
            <td>{{ member.name }}</td>
            <td v-if="isAdmin">
              <select
                :value="member.role"
                @change="changeRole(member.userId, ($event.target as HTMLSelectElement).value as Member['role'])"
              >
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
            </td>
            <td v-else>
              {{ t(`invite.roles.${member.role}`) }}
            </td>
            <td v-if="isAdmin">
              <button
                v-if="confirmingRemove !== member.userId"
                type="button"
                class="secondary"
                @click="confirmingRemove = member.userId"
              >
                {{ t('members.remove') }}
              </button>
              <div
                v-else
                class="confirm-remove"
              >
                <p>{{ t('members.confirmRemove') }}</p>
                <button
                  type="button"
                  @click="removeMember(member.userId)"
                >
                  {{ t('members.confirmRemoveButton') }}
                </button>
                <button
                  type="button"
                  class="secondary"
                  @click="confirmingRemove = null"
                >
                  {{ t('members.cancel') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

th,
td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color, #ddd);
}

th {
  font-weight: 600;
}

select {
  font-size: 1rem;
  padding: 0.5rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background-color: var(--bg-color, white);
  color: var(--text-color, black);
}

.confirm-remove {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.confirm-remove p {
  margin: 0;
  font-size: 0.9rem;
}

.confirm-remove button {
  font-size: 0.9rem;
  padding: 0.5rem 0.75rem;
}
</style>
