<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import type { Partner } from '../../shared'
import { z } from 'zod'
import { catalogSearchMatches, driverEmailError, driverPhoneError, PARTNER_NOTE_MAX_LENGTH, partnerListSchema, partnerNameSchema, partnerSchema } from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'
import { httpStatus } from '../transfer-day-http'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const listTitleId = useId()
const searchId = useId()
const query = ref('')
const includeArchived = ref(false)

const partners = ref<Partner[]>([])
const loading = ref(false)
const loadErrorKey = ref<PartnerFailure | null>(null)
const formErrorKey = ref<PartnerFailure | null>(null)
const saving = ref(false)
const archiveErrorKey = ref<PartnerFailure | null>(null)
const archivingId = ref<string | null>(null)
const restoring = ref(false)

/**
 * Add and correct share one panel. Archive stays a separate confirm.
 * An archived row opens read-only and can be restored from that panel.
 * Podaci is the only tab. Nedostupnost and Vožnje arrive on later tickets.
 */
const formMode = ref<'add' | 'edit' | null>(null)
const editingId = ref<string | null>(null)
const cardTab = ref<'data'>('data')
/** The panel title stays the name that was opened, not the half-typed correction. */
const openedName = ref('')
const archiveTarget = ref<Partner | null>(null)
const state = reactive({
  name: '',
  phone: '',
  email: '',
  note: '',
})

type PartnerFailure = 'partners.loadFailed' | 'partners.rejected' | 'partners.notFound' | 'partners.forbidden' | 'partners.signedOut' | 'partners.saveFailed' | 'partners.archivedLocked'
interface PartnerForm {
  name: string
  phone: string
  email: string
  note: string
}

const cardTabs = computed(() => [
  { label: t('partners.tabs.data'), value: 'data' as const },
])

const phoneColumn = { class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }
const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('partners.name') },
  { accessorKey: 'phone' as const, header: t('partners.phone'), meta: phoneColumn },
  { accessorKey: 'email' as const, header: t('partners.email'), meta: phoneColumn },
  { id: 'status', header: '', meta: phoneColumn },
  { id: 'actions', header: '' },
])

const visiblePartners = computed(() => partners.value.filter(partner =>
  catalogSearchMatches(query.value, [
    partner.name,
    partner.phone ?? '',
    partner.email ?? '',
    partner.note ?? '',
    partner.archivedAt ? t('partners.archived') : '',
  ]),
))

/** An archived row opens for reading. The server refuses a correction. */
const archivedView = computed(() => {
  if (formMode.value !== 'edit' || editingId.value === null)
    return false
  return partners.value.find(partner => partner.id === editingId.value)?.archivedAt != null
})

const archiveOpen = computed({
  get: () => archiveTarget.value !== null,
  set(open: boolean) {
    if (!open && archivingId.value === null)
      archiveTarget.value = null
  },
})

/** Messages follow the active Locale. Phone, email, and note may be left blank. */
const schema = computed(() => z.object({
  name: z.string().superRefine((value, ctx) => {
    if (partnerNameSchema.safeParse(value).success)
      return
    const empty = value.trim().length === 0
    ctx.addIssue({ code: 'custom', message: t(empty ? 'partners.nameEmpty' : 'partners.nameTooLong') })
  }),
  phone: z.string().superRefine((value, ctx) => {
    if (value.trim() !== '' && driverPhoneError(value) !== null)
      ctx.addIssue({ code: 'custom', message: t('partners.phoneTooLong') })
  }),
  email: z.string().superRefine((value, ctx) => {
    if (driverEmailError(value) !== null)
      ctx.addIssue({ code: 'custom', message: t('partners.emailInvalid') })
  }),
  note: z.string().superRefine((value, ctx) => {
    if (value.trim().length > PARTNER_NOTE_MAX_LENGTH)
      ctx.addIssue({ code: 'custom', message: t('partners.noteTooLong') })
  }),
}))

const formOpen = computed({
  get: () => formMode.value !== null,
  set(open: boolean) {
    if (!open && !saving.value && !restoring.value)
      formMode.value = null
  },
})

const formTitle = computed(() => formMode.value === 'edit' ? openedName.value : t('partners.add'))
const submitLabel = computed(() => {
  if (saving.value)
    return formMode.value === 'edit' ? t('partners.saving') : t('partners.submitting')
  return formMode.value === 'edit' ? t('partners.save') : t('partners.submit')
})

function failureKey(error: unknown): PartnerFailure {
  switch (httpStatus(error)) {
    case 400: return 'partners.rejected'
    case 401: return 'partners.signedOut'
    case 403: return 'partners.forbidden'
    case 404: return 'partners.notFound'
    case 409: return 'partners.archivedLocked'
    default: return 'partners.saveFailed'
  }
}

function partnerActions(partner: Partner): DropdownMenuItem[][] {
  if (partner.archivedAt !== null)
    return []
  return [[
    {
      label: t('partners.archive'),
      icon: 'i-lucide-archive',
      onSelect: () => askArchive(partner),
    },
  ]]
}

/** The phone row's second line. A blank contact still names an archived row. */
function partnerSecondLine(partner: Partner): string {
  const contact = partner.phone ?? partner.email ?? ''
  if (!partner.archivedAt)
    return contact
  return contact === '' ? t('partners.archived') : `${contact} · ${t('partners.archived')}`
}

/** Blank text clears the field. The API stores null, not an empty string. */
function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

async function loadPartners() {
  loading.value = true
  loadErrorKey.value = null
  try {
    const archived = includeArchived.value ? '?includeArchived=true' : ''
    partners.value = partnerListSchema.parse(await $fetch(`/api/partners${archived}`)).partners
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'partners.saveFailed' ? 'partners.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

function resetForm() {
  state.name = ''
  state.phone = ''
  state.email = ''
  state.note = ''
  openedName.value = ''
  formErrorKey.value = null
}

function openAdd() {
  editingId.value = null
  cardTab.value = 'data'
  resetForm()
  formMode.value = 'add'
}

function openEdit(partner: Partner) {
  editingId.value = partner.id
  cardTab.value = 'data'
  openedName.value = partner.name
  state.name = partner.name
  state.phone = partner.phone ?? ''
  state.email = partner.email ?? ''
  state.note = partner.note ?? ''
  formErrorKey.value = null
  formMode.value = 'edit'
}

async function onSubmit(event: FormSubmitEvent<PartnerForm>) {
  formErrorKey.value = null
  saving.value = true
  try {
    if (archivedView.value)
      return
    const body = {
      name: event.data.name.trim(),
      phone: optionalText(event.data.phone),
      email: optionalText(event.data.email),
      note: optionalText(event.data.note),
    }
    if (formMode.value === 'edit') {
      const id = editingId.value
      if (!id)
        return
      partnerSchema.parse(await $fetch(`/api/partners/${id}`, { method: 'PATCH', body }))
    }
    else {
      partnerSchema.parse(await $fetch('/api/partners', { method: 'POST', body }))
    }
    formMode.value = null
    notifyAuditChanged()
    await loadPartners()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

function askArchive(partner: Partner) {
  archiveErrorKey.value = null
  archiveTarget.value = partner
}

async function confirmArchive() {
  const partner = archiveTarget.value
  if (!partner || archivingId.value)
    return
  archivingId.value = partner.id
  archiveErrorKey.value = null
  try {
    partnerSchema.parse(await $fetch(`/api/partners/${partner.id}/archive`, { method: 'POST' }))
    archiveTarget.value = null
    notifyAuditChanged()
    await loadPartners()
  }
  catch (error) {
    archiveErrorKey.value = failureKey(error)
  }
  finally {
    archivingId.value = null
  }
}

async function confirmRestore() {
  const id = editingId.value
  if (!id || restoring.value)
    return
  restoring.value = true
  formErrorKey.value = null
  try {
    partnerSchema.parse(await $fetch(`/api/partners/${id}/restore`, { method: 'POST' }))
    formMode.value = null
    notifyAuditChanged()
    await loadPartners()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    restoring.value = false
  }
}

onMounted(() => {
  void loadPartners()
})
</script>

<template>
  <CatalogPanel
    v-model:open="formOpen"
    :title="formTitle"
    :dismissible="!saving && !restoring"
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
        <UCheckbox
          id="partner-show-archived"
          v-model="includeArchived"
          name="show-archived"
          class="mb-1 max-lg:min-h-11"
          :label="t('partners.showArchived')"
          :ui="{ label: 'max-lg:text-base' }"
          @update:model-value="loadPartners()"
        />
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
        {{ t('partners.title') }}
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
          :data="visiblePartners"
          :columns="columns"
          :loading="loading"
          class="lg:whitespace-nowrap"
          @select="(_event: Event, row: { original: Partner }) => openEdit(row.original)"
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
              {{ partnerSecondLine(row.original) }}
            </p>
          </template>
          <template #status-cell="{ row }">
            {{ row.original.archivedAt ? t('partners.archived') : '' }}
          </template>
          <template #actions-header>
            <span class="sr-only">{{ t('partners.actions') }}</span>
          </template>
          <template #actions-cell="{ row }">
            <UDropdownMenu
              v-if="row.original.archivedAt === null"
              :items="partnerActions(row.original)"
              size="sm"
            >
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                icon="i-lucide-ellipsis-vertical"
                class="h-7 min-h-7 max-lg:h-11 max-lg:min-h-11"
                :aria-label="t('partners.actionsFor', { name: row.original.name })"
              />
            </UDropdownMenu>
          </template>
          <template #loading>
            <div
              role="status"
              class="space-y-2 py-2"
            >
              <p>{{ t('partners.loading') }}</p>
              <USkeleton class="h-8 w-full" />
              <USkeleton class="h-8 w-full" />
            </div>
          </template>
          <template #empty>
            <UEmpty
              :title="query.trim() ? t('catalog.searchEmpty') : t('partners.empty')"
              icon="i-lucide-handshake"
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
      <UAlert
        v-if="formErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(formErrorKey)"
      />
      <UForm
        id="partner-form"
        novalidate
        :schema="schema"
        :state="state"
        :validate-on="[]"
        class="space-y-4"
        :class="commandInputClass"
        @submit="onSubmit"
        @error="formErrorKey = null"
      >
        <UFormField
          :label="t('partners.name')"
          name="name"
          :size="phone ? 'xl' : 'sm'"
        >
          <UInput
            v-model="state.name"
            name="name"
            type="text"
            autocomplete="off"
            class="w-full"
            :disabled="archivedView"
          />
          <template #error="{ error }">
            <span
              v-if="error"
              role="alert"
            >{{ error }}</span>
          </template>
        </UFormField>
        <UFormField
          :label="t('partners.phone')"
          name="phone"
          :size="phone ? 'xl' : 'sm'"
        >
          <UInput
            v-model="state.phone"
            name="phone"
            type="tel"
            autocomplete="off"
            class="w-full"
            :disabled="archivedView"
          />
          <template #error="{ error }">
            <span
              v-if="error"
              role="alert"
            >{{ error }}</span>
          </template>
        </UFormField>
        <UFormField
          :label="t('partners.email')"
          name="email"
          :size="phone ? 'xl' : 'sm'"
        >
          <UInput
            v-model="state.email"
            name="email"
            type="email"
            autocomplete="off"
            class="w-full"
            :disabled="archivedView"
          />
          <template #error="{ error }">
            <span
              v-if="error"
              role="alert"
            >{{ error }}</span>
          </template>
        </UFormField>
        <UFormField
          :label="t('partners.note')"
          name="note"
          :size="phone ? 'xl' : 'sm'"
        >
          <UTextarea
            v-model="state.note"
            name="note"
            :rows="4"
            class="w-full"
            :disabled="archivedView"
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

    <template #footer="{ phone }">
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :size="commandControlSize(phone)"
        class="w-full justify-center sm:w-auto"
        :class="commandControlClass(phone)"
        :disabled="saving || restoring"
        @click="formOpen = false"
      >
        {{ t('partners.cancel') }}
      </UButton>
      <UButton
        v-if="archivedView"
        type="button"
        :size="commandControlSize(phone)"
        class="w-full justify-center sm:w-auto"
        :class="commandControlClass(phone)"
        :loading="restoring"
        @click="confirmRestore"
      >
        {{ t('partners.unarchive') }}
      </UButton>
      <UButton
        v-else
        type="submit"
        form="partner-form"
        :size="commandControlSize(phone)"
        class="w-full justify-center sm:w-auto"
        :class="commandControlClass(phone)"
        :loading="saving"
      >
        {{ submitLabel }}
      </UButton>
    </template>
  </CatalogPanel>

  <UModal
    v-model:open="archiveOpen"
    :title="t('partners.archive')"
    :dismissible="archivingId === null"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #body>
      <p
        v-if="archiveTarget"
        class="mb-2 font-medium"
      >
        {{ archiveTarget.name }}
      </p>
      <p>{{ t('partners.confirmArchive') }}</p>
      <UAlert
        v-if="archiveErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(archiveErrorKey)"
      />
    </template>
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="archivingId !== null"
        @click="archiveOpen = false"
      >
        {{ t('partners.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="archivingId !== null"
        @click="confirmArchive"
      >
        {{ t('partners.archive') }}
      </UButton>
    </template>
  </UModal>
</template>
