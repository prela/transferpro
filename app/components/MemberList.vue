<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
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
const removing = ref(false)
// True only after this dialog's removal failed, so a role-change alert is not repeated inside it.
const removeError = ref(false)
const confirmingRoleId = ref<string | null>(null)
const nextRole = ref<Member['role'] | undefined>()
const changingRole = ref(false)
// True only after this dialog's change failed.
const roleError = ref(false)

/** Office control: 28px on the desktop, 44px on the phone. ADR-0038. */
const controlClass = 'h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base'

const roleItems = computed(() => [
  { label: t('invite.roles.admin'), value: 'admin' as const },
  { label: t('invite.roles.dispatcher'), value: 'dispatcher' as const },
  { label: t('invite.roles.driver'), value: 'driver' as const },
])

const phoneColumn = { class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }

const columns = computed(() => {
  const cols: { accessorKey?: 'name' | 'email' | 'role', id?: string, header: string, meta?: typeof phoneColumn }[] = [
    { accessorKey: 'name', header: t('members.name') },
    { accessorKey: 'email', header: t('members.email'), meta: phoneColumn },
    { accessorKey: 'role', header: t('members.role') },
  ]
  if (props.isAdmin)
    cols.push({ id: 'actions', header: t('members.actions') })
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

const confirmingMember = computed(() =>
  members.value.find(member => member.userId === confirmingRemove.value),
)

const confirmingRoleMember = computed(() =>
  members.value.find(member => member.userId === confirmingRoleId.value),
)

// X and Cancel write false. Esc and the overlay do too, except while a removal is in flight.
const removeOpen = computed({
  get: () => confirmingRemove.value !== null,
  set(open: boolean) {
    if (!open && !removing.value)
      confirmingRemove.value = null
  },
})

const roleOpen = computed({
  get: () => confirmingRoleId.value !== null,
  set(open: boolean) {
    if (!open && !changingRole.value)
      confirmingRoleId.value = null
  },
})

function askRole(userId: string) {
  operationError.value = null
  roleError.value = false
  nextRole.value = members.value.find(member => member.userId === userId)?.role
  confirmingRoleId.value = userId
}

async function confirmRole() {
  const userId = confirmingRoleId.value
  const role = nextRole.value
  const member = members.value.find(item => item.userId === userId)
  if (!userId || role === undefined || !member || role === member.role)
    return

  operationError.value = null
  changingRole.value = true
  try {
    await $fetch(`/api/members/${userId}/role`, {
      method: 'PATCH',
      body: { role },
    })
    roleError.value = false
    confirmingRoleId.value = null
    notifyAuditChanged()
    await loadMembers()
  }
  catch (error) {
    operationError.value = conflictKey(error, userId) ?? 'members.changeRoleFailed'
    roleError.value = true
  }
  finally {
    changingRole.value = false
  }
}

async function removeMember(userId: string) {
  operationError.value = null
  removing.value = true
  try {
    await $fetch(`/api/members/${userId}`, {
      method: 'DELETE',
    })
    removeError.value = false
    confirmingRemove.value = null
    notifyAuditChanged()
    await loadMembers()
  }
  catch (error) {
    // Keep the dialog open. The alert below is the same operationError the list already shows.
    operationError.value = conflictKey(error, userId) ?? 'members.removeFailed'
    removeError.value = true
  }
  finally {
    removing.value = false
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
  return members.value.find(member => member.userId === userId)?.role === 'admin' ? 'members.lastAdmin' : null
}

function isConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null)
    return false
  return ('statusCode' in error && error.statusCode === 409)
    || ('status' in error && error.status === 409)
}

function canModify(userId: string): boolean {
  // An admin cannot remove themselves or change their own role.
  return userId !== props.currentUserId
}

function memberActions(member: Member): DropdownMenuItem[][] {
  return [[
    {
      label: t('members.changeRole'),
      onSelect: () => askRole(member.userId),
    },
    {
      label: t('members.remove'),
      onSelect: () => {
        removeError.value = false
        confirmingRemove.value = member.userId
      },
    },
  ]]
}

onMounted(() => {
  loadMembers()
})
</script>

<template>
  <section :aria-label="t('members.title')">
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
        v-if="operationError && !removeError && !roleError"
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
          <p class="mt-0.5 text-sm text-muted lg:hidden">
            {{ row.original.email }}
          </p>
        </template>
        <template #email-cell="{ row }">
          {{ row.original.email }}
        </template>
        <template #role-cell="{ row }">
          {{ t(`invite.roles.${row.original.role}`) }}
        </template>
        <template #actions-header>
          <span class="sr-only">{{ t('members.actions') }}</span>
        </template>
        <template #actions-cell="{ row }">
          <UDropdownMenu
            v-if="isAdmin && canModify(row.original.userId)"
            :items="memberActions(row.original)"
            size="sm"
          >
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-ellipsis-vertical"
              :class="controlClass"
              :aria-label="t('members.actionsFor', { name: row.original.name })"
            />
          </UDropdownMenu>
        </template>
      </UTable>
    </div>
    <UModal
      v-model:open="roleOpen"
      :title="t('members.changeRole')"
      :dismissible="!changingRole"
    >
      <template #body>
        <!-- The submit button stays in the form so Enter confirms the new role. -->
        <form @submit.prevent="confirmRole">
          <p
            v-if="confirmingRoleMember"
            class="mb-2 font-medium"
          >
            {{ confirmingRoleMember.name }}
          </p>
          <p class="mb-4">
            {{ t('members.confirmChangeRole', { name: confirmingRoleMember?.name ?? '' }) }}
          </p>
          <UFormField
            :label="t('members.newRole')"
            name="new-role"
            size="xl"
          >
            <USelect
              v-model="nextRole"
              :items="roleItems"
              :portal="true"
              :aria-label="t('members.newRole')"
              class="w-full"
            />
          </UFormField>
          <UAlert
            v-if="roleError && operationError"
            color="error"
            variant="subtle"
            role="alert"
            class="mt-4"
            :description="t(operationError)"
          />
          <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              size="sm"
              :class="controlClass"
              class="w-full justify-center sm:w-auto"
              @click="confirmingRoleId = null"
            >
              {{ t('members.cancel') }}
            </UButton>
            <UButton
              type="submit"
              size="sm"
              :class="controlClass"
              class="w-full justify-center sm:w-auto"
              :loading="changingRole"
              :disabled="nextRole === undefined || nextRole === confirmingRoleMember?.role"
            >
              {{ t('members.changeRole') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="removeOpen"
      :title="t('members.remove')"
      :dismissible="!removing"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p
          v-if="confirmingMember?.name"
          class="mb-2 font-medium"
        >
          {{ confirmingMember.name }}
        </p>
        <p>{{ t('members.confirmRemove') }}</p>
        <UAlert
          v-if="removeError && operationError"
          color="error"
          variant="subtle"
          role="alert"
          class="mt-4"
          :description="t(operationError)"
        />
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="sm"
          :class="controlClass"
          class="w-full justify-center sm:w-auto"
          @click="confirmingRemove = null"
        >
          {{ t('members.cancel') }}
        </UButton>
        <UButton
          type="button"
          color="error"
          size="sm"
          :class="controlClass"
          class="w-full justify-center sm:w-auto"
          :loading="removing"
          @click="confirmingRemove && removeMember(confirmingRemove)"
        >
          {{ t('members.confirmRemoveButton') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
