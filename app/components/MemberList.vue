<script setup lang="ts">
import type { Member } from '../../shared'
import { memberListSchema } from '../../shared'

defineProps<{
  isAdmin: boolean
  currentUserId?: string
}>()

const { t } = useI18n()

const members = ref<Member[]>([])
const loading = ref(false)
const loadError = ref(false)
const operationError = ref<string | null>(null)
const confirmingRemove = ref<string | null>(null)
const changingRole = ref<{ userId: string, newRole: Member['role'] } | null>(null)

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
  const oldRole = members.value.find(m => m.userId === userId)?.role
  operationError.value = null
  changingRole.value = { userId, newRole }
  try {
    await $fetch(`/api/members/${userId}/role`, {
      method: 'PATCH',
      body: { role: newRole },
    })
    await loadMembers()
  }
  catch (error) {
    // Revert the select on failure
    const member = members.value.find(m => m.userId === userId)
    if (member && oldRole) {
      member.role = oldRole
    }
    operationError.value = isLastAdminError(error)
      ? 'members.lastAdmin'
      : 'members.changeRoleFailed'
  }
  finally {
    changingRole.value = null
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

function canModify(userId: string, currentUserId?: string): boolean {
  // An admin cannot remove themselves or change their own role
  return userId !== currentUserId
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
            <td>
              {{ member.name }}
              <span
                v-if="member.userId === currentUserId"
                class="you-badge"
              >({{ t('members.you') }})</span>
            </td>
            <td v-if="isAdmin && canModify(member.userId, currentUserId)">
              <select
                :value="member.role"
                :disabled="changingRole?.userId === member.userId"
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
            <td v-if="isAdmin && canModify(member.userId, currentUserId)">
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
            <td v-else-if="isAdmin" />
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
  border-bottom: 1px solid var(--line);
}

th {
  font-weight: 600;
}

.you-badge {
  margin-left: 0.5rem;
  color: var(--muted);
  font-size: 0.875rem;
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
