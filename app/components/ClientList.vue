<script setup lang="ts">
import type { Client, ClientKind } from '../../shared'
import { clientKindError, clientListSchema, clientNameError, clientSchema } from '../../shared'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()
const listTitleId = useId()

const clients = ref<Client[]>([])
const loading = ref(false)
const loadErrorKey = ref<ClientFailure | null>(null)
const formErrorKey = ref<ClientFailure | null>(null)
const name = ref('')
const kind = ref<ClientKind>()
const nameErrorKey = ref<NameErrorKey | null>(null)
const kindErrorKey = ref<'clients.kindInvalid' | null>(null)
const pending = ref(false)

const editing = ref<Client | null>(null)
const editName = ref('')
const editKind = ref<ClientKind>()
const editNameErrorKey = ref<NameErrorKey | null>(null)
const editKindErrorKey = ref<'clients.kindInvalid' | null>(null)
const editErrorKey = ref<ClientFailure | null>(null)
const saving = ref(false)

type NameErrorKey = 'clients.nameEmpty' | 'clients.nameTooLong'
type ClientFailure = 'clients.loadFailed' | 'clients.rejected' | 'clients.notFound' | 'clients.forbidden' | 'clients.signedOut' | 'clients.saveFailed'

const kindItems = computed(() => [
  { label: t('clients.kinds.agency'), value: 'agency' as const },
  { label: t('clients.kinds.hotel'), value: 'hotel' as const },
  { label: t('clients.kinds.individual'), value: 'individual' as const },
])

const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('clients.name') },
  { id: 'kind', header: t('clients.kind') },
  { id: 'actions', header: '' },
])

const editOpen = computed({
  get: () => editing.value !== null,
  set(open: boolean) {
    if (!open && !saving.value)
      editing.value = null
  },
})

function failureKey(error: unknown): ClientFailure {
  switch (httpStatus(error)) {
    case 400: return 'clients.rejected'
    case 401: return 'clients.signedOut'
    case 403: return 'clients.forbidden'
    case 404: return 'clients.notFound'
    default: return 'clients.saveFailed'
  }
}

function nameKey(value: string): NameErrorKey | null {
  const problem = clientNameError(value)
  if (problem === 'empty')
    return 'clients.nameEmpty'
  if (problem === 'too-long')
    return 'clients.nameTooLong'
  return null
}

async function loadClients() {
  loading.value = true
  loadErrorKey.value = null
  try {
    const next = clientListSchema.parse(await $fetch('/api/clients')).clients
    clients.value = next
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'clients.saveFailed' ? 'clients.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

async function addClient() {
  const chosen = kind.value
  nameErrorKey.value = nameKey(name.value)
  kindErrorKey.value = clientKindError(chosen ?? '') ? 'clients.kindInvalid' : null
  formErrorKey.value = null
  if (nameErrorKey.value || kindErrorKey.value || chosen === undefined)
    return
  pending.value = true
  try {
    clientSchema.parse(await $fetch('/api/clients', {
      method: 'POST',
      body: { name: name.value, kind: chosen },
    }))
    name.value = ''
    kind.value = undefined
    notifyAuditChanged()
    await loadClients()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    pending.value = false
  }
}

function openEdit(client: Client) {
  editing.value = client
  editName.value = client.name
  editKind.value = client.kind
  editNameErrorKey.value = null
  editKindErrorKey.value = null
  editErrorKey.value = null
}

async function saveEdit() {
  const current = editing.value
  const chosen = editKind.value
  if (!current)
    return
  editNameErrorKey.value = nameKey(editName.value)
  editKindErrorKey.value = clientKindError(chosen ?? '') ? 'clients.kindInvalid' : null
  editErrorKey.value = null
  if (editNameErrorKey.value || editKindErrorKey.value || chosen === undefined)
    return
  saving.value = true
  try {
    clientSchema.parse(await $fetch(`/api/clients/${current.id}`, {
      method: 'PATCH',
      body: { name: editName.value, kind: chosen },
    }))
    editing.value = null
    notifyAuditChanged()
    await loadClients()
  }
  catch (error) {
    editErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
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

onMounted(loadClients)
</script>

<template>
  <section>
    <h2
      :id="titleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t('clients.add') }}
    </h2>
    <UAlert
      v-if="formErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(formErrorKey)"
    />
    <form @submit.prevent="addClient">
      <UFormField
        :label="t('clients.name')"
        name="name"
        class="mb-4"
        size="xl"
        :error="nameErrorKey ? t(nameErrorKey) : false"
      >
        <UInput
          id="client-name"
          v-model="name"
          name="name"
          type="text"
          autocomplete="off"
          class="w-full"
          @update:model-value="nameErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('clients.kind')"
        name="kind"
        class="mb-4"
        size="xl"
        :error="kindErrorKey ? t(kindErrorKey) : false"
      >
        <USelect
          id="client-kind"
          v-model="kind"
          name="kind"
          :items="kindItems"
          :placeholder="t('clients.chooseKind')"
          class="w-full"
          @update:model-value="kindErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UButton
        type="submit"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="pending"
      >
        {{ pending ? t('clients.submitting') : t('clients.submit') }}
      </UButton>
    </form>

    <h2
      :id="listTitleId"
      class="mt-8 mb-4 text-xl font-semibold"
    >
      {{ t('clients.title') }}
    </h2>
    <UAlert
      v-if="loadErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      :description="t(loadErrorKey)"
    />
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('clients.loading') }}
    </p>
    <p v-else-if="clients.length === 0">
      {{ t('clients.empty') }}
    </p>
    <div
      v-else
      class="overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      role="region"
      :aria-labelledby="listTitleId"
      tabindex="0"
    >
      <UTable
        :data="clients"
        :columns="columns"
        class="whitespace-nowrap"
      >
        <template #kind-cell="{ row }">
          {{ t(`clients.kinds.${row.original.kind}`) }}
        </template>
        <template #actions-cell="{ row }">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="`${t('clients.edit')}: ${row.original.name}`"
            @click="openEdit(row.original)"
          >
            {{ t('clients.edit') }}
          </UButton>
        </template>
      </UTable>
    </div>

    <UModal
      v-model:open="editOpen"
      :title="t('clients.edit')"
      :dismissible="!saving"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <UAlert
          v-if="editErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mb-4"
          :description="t(editErrorKey)"
        />
        <form
          id="client-edit"
          @submit.prevent="saveEdit"
        >
          <UFormField
            :label="t('clients.name')"
            name="edit-name"
            class="mb-4"
            size="xl"
            :error="editNameErrorKey ? t(editNameErrorKey) : false"
          >
            <UInput
              id="client-edit-name"
              v-model="editName"
              name="edit-name"
              type="text"
              autocomplete="off"
              class="w-full"
              @update:model-value="editNameErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('clients.kind')"
            name="edit-kind"
            class="mb-4"
            size="xl"
            :error="editKindErrorKey ? t(editKindErrorKey) : false"
          >
            <USelect
              id="client-edit-kind"
              v-model="editKind"
              name="edit-kind"
              :items="kindItems"
              class="w-full"
              @update:model-value="editKindErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
        </form>
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="saving"
          @click="editing = null"
        >
          {{ t('clients.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="saving"
          @click="saveEdit"
        >
          {{ saving ? t('clients.saving') : t('clients.save') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
