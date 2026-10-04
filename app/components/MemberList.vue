<script setup lang="ts">
import type { Member } from '../../shared'
import { memberListSchema } from '../../shared'

const props = defineProps<{
  isAdmin: boolean
  currentUserId: string
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const members = ref<Member[]>([])
const loading = ref(false)
const loadError = ref(false)
const operationError = ref<string | null>(null)
const confirmingRemove = ref<string | null>(null)
const changingRole = ref<{ userId: string, oldRole: Member['role'], newRole: Member['role'] } | null>(null)
// The chosen role shows at once. A failed change drops it so the select returns to the loaded role.
const chosenRole = ref<Partial<Record<string, Member['role']>>>({})

const roleItems = computed(() => [
  { label: t('invite.roles.admin'), value: 'admin' as const },
  { label: t('invite.roles.dispatcher'), value: 'dispatcher' as const },
  { label: t('invite.roles.driver'), value: 'driver' as const },
])

const columns = computed(() => {
  const cols: { accessorKey?: 'name' | 'role', id?: string, header: string }[] = [
    { accessorKey: 'name', header: t('members.name') },
    { accessorKey: 'role', header: t('members.role') },
  ]
  if (props.isAdmin)
    cols.push({ id: 'actions', header: '' })
  return cols
})

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

function displayedRole(member: Member): Member['role'] {
  return chosenRole.value[member.userId] ?? member.role
}

function keepChosenRole(userId: string, role: Member['role'] | undefined) {
  const next = { ...chosenRole.value }
  if (role === undefined)
    delete next[userId]
  else
    next[userId] = role
  chosenRole.value = next
}

async function changeRole(userId: string, newRole: Member['role']) {
  const member = members.value.find(m => m.userId === userId)
  if (!member || newRole === member.role)
    return

  const oldRole = member.role
  operationError.value = null
  changingRole.value = { userId, oldRole, newRole }
  keepChosenRole(userId, newRole)

  try {
    await $fetch(`/api/members/${userId}/role`, {
      method: 'PATCH',
      body: { role: newRole },
    })
    notifyAuditChanged()
    await loadMembers()
    keepChosenRole(userId, undefined)
  }
  catch (error) {
    keepChosenRole(userId, undefined)
    operationError.value = conflictKey(error, userId) ?? 'members.changeRoleFailed'
  }
  finally {
    changingRole.value = null
  }
}

function onRoleChange(userId: string, value: string) {
  if (value !== 'admin' && value !== 'dispatcher' && value !== 'driver')
    return
  changeRole(userId, value)
}

async function removeMember(userId: string) {
  operationError.value = null
  try {
    await $fetch(`/api/members/${userId}`, {
      method: 'DELETE',
    })
    confirmingRemove.value = null
    notifyAuditChanged()
    await loadMembers()
  }
  catch (error) {
    confirmingRemove.value = null
    operationError.value = conflictKey(error, userId) ?? 'members.removeFailed'
  }
}

/**
 * Every 409 reads "Conflict", so the row tells the reason: the caller's own
 * row, or an admin who may be the last one. Any other 409 is a plain failure.
 */
function conflictKey(error: unknown, userId: string): string | null {
  if (!isConflict(error))
    return null
  if (userId === props.currentUserId)
    return 'members.cannotModifySelf'
  return members.value.find(m => m.userId === userId)?.role === 'admin' ? 'members.lastAdmin' : null
}

function isConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null)
    return false
  return ('statusCode' in error && error.statusCode === 409)
    || ('status' in error && error.status === 409)
}

function canModify(userId: string, currentUserId: string): boolean {
  // An admin cannot remove themselves or change their own role
  return userId !== currentUserId
}

onMounted(() => {
  loadMembers()
})
</script>

<template>
  <section>
    <h2 class="mt-6 mb-4 text-xl font-semibold">
      {{ t('members.title') }}
    </h2>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      :description="t('members.loadFailed')"
    />
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('members.loading') }}
    </p>
    <div v-else>
      <UAlert
        v-if="operationError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(operationError)"
      />
      <UTable
        v-if="members.length > 0"
        :data="members"
        :columns="columns"
      >
        <template #name-cell="{ row }">
          {{ row.original.name }}
          <span
            v-if="row.original.userId === currentUserId"
            class="ms-2 text-sm text-muted"
          >({{ t('members.you') }})</span>
        </template>
        <template #role-cell="{ row }">
          <USelect
            v-if="isAdmin && canModify(row.original.userId, currentUserId)"
            :model-value="displayedRole(row.original)"
            :items="roleItems"
            :disabled="changingRole?.userId === row.original.userId"
            :aria-label="t('members.role')"
            size="xl"
            class="w-full"
            @update:model-value="onRoleChange(row.original.userId, String($event))"
          />
          <span v-else>{{ t(`invite.roles.${row.original.role}`) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <template v-if="isAdmin && canModify(row.original.userId, currentUserId)">
            <UButton
              v-if="confirmingRemove !== row.original.userId"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              @click="confirmingRemove = row.original.userId"
            >
              {{ t('members.remove') }}
            </UButton>
            <div
              v-else
              class="flex flex-col gap-2"
            >
              <p class="text-sm">
                {{ t('members.confirmRemove') }}
              </p>
              <UButton
                type="button"
                color="error"
                size="xl"
                @click="removeMember(row.original.userId)"
              >
                {{ t('members.confirmRemoveButton') }}
              </UButton>
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                size="xl"
                @click="confirmingRemove = null"
              >
                {{ t('members.cancel') }}
              </UButton>
            </div>
          </template>
        </template>
      </UTable>
    </div>
  </section>
</template>
