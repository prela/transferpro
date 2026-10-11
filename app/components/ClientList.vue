<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import type { Client, ClientKind } from '../../shared'
import { z } from 'zod'
import { CLIENT_KINDS, CLIENT_NAME_MAX_LENGTH, clientListSchema, clientSchema } from '../../shared'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const listTitleId = useId()

const clients = ref<Client[]>([])
const loading = ref(false)
const loadErrorKey = ref<ClientFailure | null>(null)
const formErrorKey = ref<ClientFailure | null>(null)
const saving = ref(false)

/**
 * Add and correct share one slideover. A Client has no archive:
 * ADR-0017 keeps the row, and there is no archive route.
 */
const formMode = ref<'add' | 'edit' | null>(null)
const editingId = ref<string | null>(null)
const state = reactive<{ name: string, kind?: ClientKind }>({ name: '' })

type ClientFailure = 'clients.loadFailed' | 'clients.rejected' | 'clients.notFound' | 'clients.forbidden' | 'clients.signedOut' | 'clients.saveFailed'
interface ClientForm {
  name: string
  kind: ClientKind
}

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

/** Messages follow the active Locale. UForm reads this schema on submit. */
const schema = computed(() => z.object({
  name: z.string().trim().min(1, t('clients.nameEmpty')).max(CLIENT_NAME_MAX_LENGTH, t('clients.nameTooLong')),
  kind: z.enum(CLIENT_KINDS, { error: t('clients.kindInvalid') }),
}))

const formOpen = computed({
  get: () => formMode.value !== null,
  set(open: boolean) {
    if (!open && !saving.value)
      formMode.value = null
  },
})

const formTitle = computed(() => formMode.value === 'edit' ? t('clients.edit') : t('clients.add'))
const submitLabel = computed(() => {
  if (saving.value)
    return formMode.value === 'edit' ? t('clients.saving') : t('clients.submitting')
  return formMode.value === 'edit' ? t('clients.save') : t('clients.submit')
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

function clientActions(client: Client): DropdownMenuItem[][] {
  return [[
    {
      label: t('clients.edit'),
      icon: 'i-lucide-pencil',
      onSelect: () => openEdit(client),
    },
  ]]
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

function openAdd() {
  editingId.value = null
  state.name = ''
  state.kind = undefined
  formErrorKey.value = null
  formMode.value = 'add'
}

function openEdit(client: Client) {
  editingId.value = client.id
  state.name = client.name
  state.kind = client.kind
  formErrorKey.value = null
  formMode.value = 'edit'
}

async function onSubmit(event: FormSubmitEvent<ClientForm>) {
  formErrorKey.value = null
  saving.value = true
  try {
    if (formMode.value === 'edit') {
      const id = editingId.value
      if (!id)
        return
      clientSchema.parse(await $fetch(`/api/clients/${id}`, {
        method: 'PATCH',
        body: { name: event.data.name, kind: event.data.kind },
      }))
    }
    else {
      clientSchema.parse(await $fetch('/api/clients', {
        method: 'POST',
        body: { name: event.data.name, kind: event.data.kind },
      }))
    }
    formMode.value = null
    notifyAuditChanged()
    await loadClients()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
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
    <UButton
      type="button"
      size="xl"
      icon="i-lucide-plus"
      class="mb-4"
      @click="openAdd"
    >
      {{ t('clients.add') }}
    </UButton>

    <h2
      :id="listTitleId"
      class="mb-4 text-xl font-semibold"
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
        :loading="loading"
        class="whitespace-nowrap"
      >
        <template #kind-cell="{ row }">
          {{ t(`clients.kinds.${row.original.kind}`) }}
        </template>
        <template #actions-header>
          <span class="sr-only">{{ t('clients.actions') }}</span>
        </template>
        <template #actions-cell="{ row }">
          <UDropdownMenu
            :items="clientActions(row.original)"
            size="xl"
          >
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              icon="i-lucide-ellipsis-vertical"
              :aria-label="t('clients.actionsFor', { name: row.original.name })"
            />
          </UDropdownMenu>
        </template>
        <template #loading>
          <div
            role="status"
            class="space-y-2 py-2"
          >
            <p>{{ t('clients.loading') }}</p>
            <USkeleton class="h-8 w-full" />
            <USkeleton class="h-8 w-full" />
          </div>
        </template>
        <template #empty>
          <UEmpty
            :title="t('clients.empty')"
            icon="i-lucide-users"
            variant="naked"
          />
        </template>
      </UTable>
    </div>

    <USlideover
      v-model:open="formOpen"
      :title="formTitle"
      :dismissible="!saving"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <UAlert
          v-if="formErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mb-4"
          :description="t(formErrorKey)"
        />
        <UForm
          id="client-form"
          :schema="schema"
          :state="state"
          :validate-on="[]"
          class="space-y-4"
          @submit="onSubmit"
          @error="formErrorKey = null"
        >
          <UFormField
            :label="t('clients.name')"
            name="name"
            size="xl"
          >
            <UInput
              v-model="state.name"
              name="name"
              type="text"
              autocomplete="off"
              class="w-full"
            />
            <template #error="{ error }">
              <span
                v-if="error"
                role="alert"
              >{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('clients.kind')"
            name="kind"
            size="xl"
          >
            <USelect
              v-model="state.kind"
              name="kind"
              :items="kindItems"
              :placeholder="t('clients.chooseKind')"
              class="w-full"
            />
            <template #error="{ error }">
              <span
                v-if="error"
                role="alert"
              >{{ error }}</span>
            </template>
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="saving"
          @click="formOpen = false"
        >
          {{ t('clients.cancel') }}
        </UButton>
        <UButton
          type="submit"
          form="client-form"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </USlideover>
  </section>
</template>
