<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ClientKind, ClientListEntry, DisplayLocale } from '../../shared'
import { z } from 'zod'
import { catalogSearchMatches, CLIENT_KINDS, CLIENT_NAME_MAX_LENGTH, clientListSchema, clientSchema } from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'
import { errorCode, httpStatus } from '../transfer-day-http'

defineProps<{
  /** The refusal names when a colleague saved, in the Tenant time zone. */
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const listTitleId = useId()
const searchId = useId()

const clients = ref<ClientListEntry[]>([])
const query = ref('')
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
/** Podaci is the name and the kind. Kontakti is this Client's contact persons. */
const cardTab = ref<'data' | 'contacts'>('data')
/** The panel title stays the name that was opened, not the half-typed correction. */
const openedName = ref('')
/** The version the edit form opened with. Only Osvježi replaces it (ADR-0046). */
const openedVersion = ref(0)
const state = reactive<{ name: string, kind?: ClientKind }>({ name: '' })
/** 409 `stale_save`: the typed values stay, and the notice offers Osvježi. */
const staleNotice = ref(false)
const refreshing = ref(false)

/**
 * The row the edit form is on, as the list last read it. The 409 carries no
 * name, so the notice reads who and when from here. Until that row's version
 * moves past the opened one, the read has not seen the winning save, and the
 * notice must not name the author already on screen.
 */
const staleRow = computed(() => {
  const row = clients.value.find(client => client.id === editingId.value)
  return row && row.version !== openedVersion.value ? row : null
})

type ClientFailure = 'clients.loadFailed' | 'clients.rejected' | 'clients.notFound' | 'clients.forbidden' | 'clients.signedOut' | 'clients.saveFailed'
interface ClientForm {
  name: string
  kind: ClientKind
}

const cardTabs = computed(() => [
  { label: t('clients.tabs.data'), value: 'data' as const },
  { label: t('clients.tabs.contacts'), value: 'contacts' as const },
])

const kindItems = computed(() => [
  { label: t('clients.kinds.agency'), value: 'agency' as const },
  { label: t('clients.kinds.hotel'), value: 'hotel' as const },
  { label: t('clients.kinds.individual'), value: 'individual' as const },
])

const phoneColumn = { class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }
const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('clients.name') },
  { id: 'kind', header: t('clients.kind'), meta: phoneColumn },
])

const visibleClients = computed(() => clients.value.filter(client =>
  catalogSearchMatches(query.value, [client.name, t(`clients.kinds.${client.kind}`)]),
))

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

const formTitle = computed(() => formMode.value === 'edit' ? openedName.value : t('clients.add'))
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

/**
 * Re-read the list behind an open form. A failure keeps the rows already on
 * screen and does not replace the table with the load error.
 */
async function rereadClients(): Promise<boolean> {
  try {
    clients.value = clientListSchema.parse(await $fetch('/api/clients')).clients
    return true
  }
  catch {
    return false
  }
}

function openAdd() {
  editingId.value = null
  cardTab.value = 'data'
  openedName.value = ''
  state.name = ''
  state.kind = undefined
  formErrorKey.value = null
  staleNotice.value = false
  formMode.value = 'add'
}

function openEdit(client: ClientListEntry) {
  editingId.value = client.id
  cardTab.value = 'data'
  openedName.value = client.name
  openedVersion.value = client.version
  state.name = client.name
  state.kind = client.kind
  formErrorKey.value = null
  staleNotice.value = false
  formMode.value = 'edit'
}

async function noteStale() {
  // The 409 carries no name. The list does. The typed values and the opened
  // version stay until Osvježi. A failed read leaves the unknown-author sentence.
  await rereadClients()
  staleNotice.value = true
}

/** Osvježi: the current row and version replace the form. A failed read keeps the notice. */
async function refreshStale() {
  if (refreshing.value)
    return
  refreshing.value = true
  try {
    if (!await rereadClients())
      return
    const row = clients.value.find(client => client.id === editingId.value)
    if (!row)
      return
    openEdit(row)
  }
  finally {
    refreshing.value = false
  }
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
        body: { name: event.data.name, kind: event.data.kind, version: openedVersion.value },
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
    // Awaited so the notice is up before the save button enables again.
    if (errorCode(error) === 'stale_save')
      await noteStale()
    else
      formErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

onMounted(loadClients)
</script>

<template>
  <CatalogPanel
    v-model:open="formOpen"
    :title="formTitle"
    :dismissible="!saving"
  >
    <template #toolbar>
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <div class="min-w-48 flex-1">
          <!-- UFormField outside a UForm does not label the input. Axe and the searchbox name need for/id. -->
          <label
            :for="searchId"
            class="mb-1 block text-sm font-medium max-lg:text-base"
          >{{ t('catalog.search') }}</label>
          <UInput
            :id="searchId"
            v-model="query"
            type="search"
            autocomplete="off"
            class="w-full"
            :class="commandInputClass"
          />
        </div>
        <UButton
          type="button"
          class="h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base"
          @click="openAdd"
        >
          {{ t('catalog.add') }}
        </UButton>
      </div>
    </template>

    <template #list>
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
        class="focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary lg:overflow-x-auto"
        role="region"
        :aria-labelledby="listTitleId"
        tabindex="0"
      >
        <UTable
          :data="visibleClients"
          :columns="columns"
          :loading="loading"
          class="lg:whitespace-nowrap"
          @select="(_event: Event, row: { original: ClientListEntry }) => openEdit(row.original)"
        >
          <template #name-cell="{ row }">
            <button
              type="button"
              class="block min-h-7 w-full text-left font-medium max-lg:min-h-11 max-lg:text-base"
              @click="openEdit(row.original)"
            >
              {{ row.original.name }}
            </button>
            <p class="mt-0.5 text-sm text-muted lg:hidden">
              {{ t(`clients.kinds.${row.original.kind}`) }}
            </p>
          </template>
          <template #kind-cell="{ row }">
            {{ t(`clients.kinds.${row.original.kind}`) }}
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
              :title="query.trim() ? t('catalog.searchEmpty') : t('clients.empty')"
              icon="i-lucide-users"
              variant="naked"
            />
          </template>
        </UTable>
      </div>
    </template>

    <template #body="{ phone }">
      <UTabs
        v-if="formMode === 'edit'"
        v-model="cardTab"
        :items="cardTabs"
        :content="false"
        :size="phone ? 'xl' : 'sm'"
        class="mb-4"
      />
      <div v-show="formMode !== 'edit' || cardTab === 'data'">
        <StaleSaveAlert
          v-if="staleNotice"
          :changed-by-name="staleRow?.changedByName ?? null"
          :changed-at="staleRow?.changedAt ?? null"
          :time-zone="timeZone"
          :locale="locale"
          :phone="phone"
          :pending="refreshing"
          @refresh="refreshStale"
        />
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
          :class="commandInputClass"
          @submit="onSubmit"
          @error="formErrorKey = null"
        >
          <UFormField
            :label="t('clients.name')"
            name="name"
            :size="phone ? 'xl' : 'sm'"
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
            :size="phone ? 'xl' : 'sm'"
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
      </div>
      <ClientContactPersons
        v-if="formMode === 'edit' && editingId && cardTab === 'contacts'"
        :client-id="editingId"
        :phone="phone"
        :time-zone="timeZone"
        :locale="locale"
      />
    </template>
    <template #footer="{ phone }">
      <template v-if="formMode !== 'edit' || cardTab === 'data'">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="commandControlSize(phone)"
          class="w-full justify-center sm:w-auto"
          :class="commandControlClass(phone)"
          :disabled="saving"
          @click="formOpen = false"
        >
          {{ t('clients.cancel') }}
        </UButton>
        <UButton
          type="submit"
          form="client-form"
          :size="commandControlSize(phone)"
          class="w-full justify-center sm:w-auto"
          :class="commandControlClass(phone)"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </template>
  </CatalogPanel>
</template>
