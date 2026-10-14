<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import type { AddressSuggestion, Location, LocationKind, LocationPlace } from '../../shared'
import { z } from 'zod'
import { LOCATION_ADDRESS_MAX_LENGTH, LOCATION_KINDS, LOCATION_NAME_MAX_LENGTH, LOCATION_SUGGEST_MIN_LENGTH, locationAddressSchema, locationIataError, locationIataSchema, locationListSchema, locationSchema, suggestAddressesResponseSchema } from '../../shared'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const listTitleId = useId()

const locations = ref<Location[]>([])
const includeArchived = ref(false)
const loading = ref(false)
const loadErrorKey = ref<LocationFailure | null>(null)
const formErrorKey = ref<LocationFailure | null>(null)
const archiveErrorKey = ref<LocationFailure | null>(null)
const saving = ref(false)
const archivingId = ref<string | null>(null)

/** Add and correct share one slideover. Archive stays a separate confirm. */
const formMode = ref<'add' | 'edit' | null>(null)
const editingId = ref<string | null>(null)
const confirming = ref<Location | null>(null)
const state = reactive<{ name: string, kind?: LocationKind, address: string, iata: string }>({
  name: '',
  address: '',
  iata: '',
})

/**
 * A pick holds the place until the next keystroke. The pause keeps the list
 * from flickering and spends the quota once per pause, not once per key.
 */
const SUGGEST_PAUSE_MS = 300
const heldPlace = ref<LocationPlace | null>(null)
const pickedText = ref<string | null>(null)
const sessionToken = ref<string | null>(null)
const suggestions = ref<AddressSuggestion[]>([])
const attribution = ref<string | null>(null)
const suggestionsUnavailable = ref(false)
let suggestTimer: number | undefined
let suggestGeneration = 0

type LocationFailure = 'locations.loadFailed' | 'locations.rejected' | 'locations.notFound' | 'locations.forbidden' | 'locations.signedOut' | 'locations.saveFailed' | 'locations.archivedLocked'
interface LocationForm {
  name: string
  kind: LocationKind
  address: string
  iata: string
}

const kindItems = computed(() => [
  { label: t('locations.kinds.airport'), value: 'airport' as const },
  { label: t('locations.kinds.hotel'), value: 'hotel' as const },
  { label: t('locations.kinds.address'), value: 'address' as const },
  { label: t('locations.kinds.other'), value: 'other' as const },
])

const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('locations.name') },
  { id: 'kind', header: t('locations.kind') },
  { accessorKey: 'address' as const, header: t('locations.address') },
  // The labeled field is the airport form. This cell shows a stored code
  // and stays blank for a hotel, an address, or other kind.
  { id: 'iata', header: '' },
  { id: 'status', header: '' },
  { id: 'actions', header: '' },
])

/** Messages follow the active Locale. A blank airport code is allowed. */
const schema = computed(() => z.object({
  name: z.string().trim().min(1, t('locations.nameEmpty')).max(LOCATION_NAME_MAX_LENGTH, t('locations.nameTooLong')),
  kind: z.enum(LOCATION_KINDS, { error: t('locations.kindInvalid') }),
  address: z.string().trim().max(LOCATION_ADDRESS_MAX_LENGTH, t('locations.addressTooLong')),
  iata: z.string(),
}).superRefine((value, ctx) => {
  if (value.kind === 'airport' && locationIataError(value.iata)) {
    ctx.addIssue({
      code: 'custom',
      message: t('locations.iataInvalid'),
      path: ['iata'],
    })
  }
}))

const formOpen = computed({
  get: () => formMode.value !== null,
  set(open: boolean) {
    if (!open && !saving.value)
      formMode.value = null
  },
})

const archiveOpen = computed({
  get: () => confirming.value !== null,
  set(open: boolean) {
    if (!open && archivingId.value === null)
      confirming.value = null
  },
})

const formTitle = computed(() => formMode.value === 'edit' ? t('locations.edit') : t('locations.add'))
const submitLabel = computed(() => {
  if (saving.value)
    return formMode.value === 'edit' ? t('locations.saving') : t('locations.submitting')
  return formMode.value === 'edit' ? t('locations.save') : t('locations.submit')
})

function failureKey(error: unknown): LocationFailure {
  if (locationErrorCode(error) === 'location_archived')
    return 'locations.archivedLocked'
  switch (httpStatus(error)) {
    case 400: return 'locations.rejected'
    case 401: return 'locations.signedOut'
    case 403: return 'locations.forbidden'
    case 404: return 'locations.notFound'
    default: return 'locations.saveFailed'
  }
}

function locationErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error))
    return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('code' in data))
    return undefined
  return typeof data.code === 'string' ? data.code : undefined
}

function locationActions(location: Location): DropdownMenuItem[][] {
  if (location.archivedAt !== null)
    return []
  return [[
    {
      label: t('locations.edit'),
      icon: 'i-lucide-pencil',
      onSelect: () => openEdit(location),
    },
    {
      label: t('locations.archive'),
      icon: 'i-lucide-archive',
      onSelect: () => askArchive(location),
    },
  ]]
}

async function loadLocations() {
  loading.value = true
  loadErrorKey.value = null
  try {
    const query = includeArchived.value ? '?includeArchived=true' : ''
    const next = locationListSchema.parse(await $fetch(`/api/locations${query}`)).locations
    locations.value = next
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'locations.saveFailed' ? 'locations.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

function resetForm() {
  state.name = ''
  state.kind = undefined
  state.address = ''
  state.iata = ''
  heldPlace.value = null
  pickedText.value = null
  sessionToken.value = null
  suggestions.value = []
  attribution.value = null
  suggestionsUnavailable.value = false
  window.clearTimeout(suggestTimer)
  formErrorKey.value = null
}

function openAdd() {
  editingId.value = null
  resetForm()
  formMode.value = 'add'
}

function openEdit(location: Location) {
  editingId.value = location.id
  state.name = location.name
  state.kind = location.kind
  state.address = location.address ?? ''
  state.iata = location.iata ?? ''
  heldPlace.value = location.place
  pickedText.value = location.address
  suggestions.value = []
  attribution.value = null
  sessionToken.value = null
  formErrorKey.value = null
  formMode.value = 'edit'
}

function onAddressInput(value: string | number | null | undefined) {
  const next = value == null ? '' : String(value)
  // A hand edit must not keep a reference to a different place.
  if (next !== pickedText.value)
    heldPlace.value = null
  state.address = next
  window.clearTimeout(suggestTimer)
  suggestTimer = window.setTimeout(() => {
    void lookupSuggestions()
  }, SUGGEST_PAUSE_MS)
}

function onAddressEnter(event: KeyboardEvent) {
  const first = suggestions.value[0]
  if (!first)
    return
  event.preventDefault()
  pickSuggestion(first)
}

async function lookupSuggestions() {
  const text = state.address.trim()
  if (text.length < LOCATION_SUGGEST_MIN_LENGTH) {
    suggestions.value = []
    attribution.value = null
    return
  }
  // One token for this typing run. A pick clears it so the next run is new.
  if (sessionToken.value === null)
    sessionToken.value = crypto.randomUUID()
  const generation = ++suggestGeneration
  try {
    const result = suggestAddressesResponseSchema.parse(await $fetch('/api/locations/suggestions', {
      method: 'POST',
      body: { text, sessionToken: sessionToken.value },
    }))
    if (generation !== suggestGeneration)
      return
    if (!result.available) {
      suggestions.value = []
      attribution.value = null
      suggestionsUnavailable.value = true
      return
    }
    suggestionsUnavailable.value = false
    suggestions.value = [...result.suggestions]
    attribution.value = result.suggestions.length > 0 ? result.attribution : null
  }
  catch {
    if (generation !== suggestGeneration)
      return
    suggestions.value = []
    attribution.value = null
    suggestionsUnavailable.value = true
  }
}

function pickSuggestion(suggestion: AddressSuggestion) {
  pickedText.value = suggestion.text
  heldPlace.value = { provider: suggestion.provider, placeRef: suggestion.placeRef }
  state.address = suggestion.text
  suggestions.value = []
  attribution.value = null
  sessionToken.value = null
  window.clearTimeout(suggestTimer)
}

function locationBody(data: LocationForm) {
  const address = locationAddressSchema.parse(data.address)
  return {
    name: data.name,
    kind: data.kind,
    address,
    place: address === null ? null : heldPlace.value,
    // A hotel, an address, or other kind cannot carry a code, so the key
    // stays off the body unless this row is an airport. Leaving airport
    // omits the key. The server clears a stored code in that same change.
    ...(data.kind === 'airport' ? { iata: locationIataSchema.parse(data.iata) } : {}),
  }
}

async function onSubmit(event: FormSubmitEvent<LocationForm>) {
  formErrorKey.value = null
  saving.value = true
  try {
    const body = locationBody(event.data)
    if (formMode.value === 'edit') {
      const id = editingId.value
      if (!id)
        return
      locationSchema.parse(await $fetch(`/api/locations/${id}`, {
        method: 'PATCH',
        body,
      }))
    }
    else {
      locationSchema.parse(await $fetch('/api/locations', {
        method: 'POST',
        body,
      }))
    }
    formMode.value = null
    notifyAuditChanged()
    await loadLocations()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

function askArchive(location: Location) {
  archiveErrorKey.value = null
  confirming.value = location
}

async function confirmArchive() {
  const location = confirming.value
  if (!location || archivingId.value)
    return
  archivingId.value = location.id
  archiveErrorKey.value = null
  try {
    locationSchema.parse(await $fetch(`/api/locations/${location.id}/archive`, { method: 'POST' }))
    confirming.value = null
    notifyAuditChanged()
    await loadLocations()
  }
  catch (error) {
    archiveErrorKey.value = failureKey(error)
  }
  finally {
    archivingId.value = null
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

onMounted(loadLocations)
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
      {{ t('locations.add') }}
    </UButton>

    <h2
      :id="listTitleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t('locations.title') }}
    </h2>
    <UCheckbox
      id="location-show-archived"
      v-model="includeArchived"
      name="show-archived"
      size="xl"
      class="mb-4"
      :label="t('locations.showArchived')"
      @update:model-value="loadLocations()"
    />
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
        :data="locations"
        :columns="columns"
        :loading="loading"
        class="whitespace-nowrap"
      >
        <template #kind-cell="{ row }">
          {{ t(`locations.kinds.${row.original.kind}`) }}
        </template>
        <template #address-cell="{ row }">
          {{ row.original.address ?? '' }}
        </template>
        <template #iata-cell="{ row }">
          {{ row.original.kind === 'airport' ? (row.original.iata ?? '') : '' }}
        </template>
        <template #status-cell="{ row }">
          {{ row.original.archivedAt ? t('locations.archived') : '' }}
        </template>
        <template #actions-header>
          <span class="sr-only">{{ t('locations.actions') }}</span>
        </template>
        <template #actions-cell="{ row }">
          <UDropdownMenu
            v-if="row.original.archivedAt === null"
            :items="locationActions(row.original)"
            size="xl"
          >
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              icon="i-lucide-ellipsis-vertical"
              :aria-label="t('locations.actionsFor', { name: row.original.name })"
            />
          </UDropdownMenu>
        </template>
        <template #loading>
          <div
            role="status"
            class="space-y-2 py-2"
          >
            <p>{{ t('locations.loading') }}</p>
            <USkeleton class="h-8 w-full" />
            <USkeleton class="h-8 w-full" />
          </div>
        </template>
        <template #empty>
          <UEmpty
            :title="t('locations.empty')"
            icon="i-lucide-map-pin"
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
          id="location-form"
          :schema="schema"
          :state="state"
          :validate-on="[]"
          class="space-y-4"
          @submit="onSubmit"
          @error="formErrorKey = null"
        >
          <UFormField
            :label="t('locations.name')"
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
            :label="t('locations.kind')"
            name="kind"
            size="xl"
          >
            <USelect
              v-model="state.kind"
              name="kind"
              :items="kindItems"
              :placeholder="t('locations.chooseKind')"
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
            :label="t('locations.address')"
            name="address"
            size="xl"
          >
            <UInput
              :model-value="state.address"
              name="address"
              type="text"
              autocomplete="off"
              class="w-full"
              :aria-expanded="suggestions.length > 0"
              aria-controls="location-suggestions"
              aria-autocomplete="list"
              @update:model-value="onAddressInput"
              @keydown.enter="onAddressEnter"
            />
            <ul
              v-if="suggestions.length > 0"
              id="location-suggestions"
              role="listbox"
              class="mt-1 overflow-hidden rounded-md border border-default"
            >
              <li
                v-for="suggestion in suggestions"
                :key="suggestion.placeRef"
                role="presentation"
              >
                <button
                  type="button"
                  role="option"
                  class="w-full px-3 py-2 text-left text-base hover:bg-elevated"
                  @click="pickSuggestion(suggestion)"
                >
                  {{ suggestion.text }}
                </button>
              </li>
            </ul>
            <p
              v-if="attribution"
              class="mt-1 text-sm text-muted"
            >
              {{ attribution }}
            </p>
            <p
              v-if="suggestionsUnavailable"
              class="mt-1 text-sm text-muted"
            >
              {{ t('locations.suggestionsUnavailable') }}
            </p>
            <template #error="{ error }">
              <span
                v-if="error"
                role="alert"
              >{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            v-if="state.kind === 'airport'"
            :label="t('locations.iata')"
            name="iata"
            size="xl"
          >
            <UInput
              v-model="state.iata"
              name="iata"
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
          {{ t('locations.cancel') }}
        </UButton>
        <UButton
          type="submit"
          form="location-form"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </USlideover>

    <UModal
      v-model:open="archiveOpen"
      :title="t('locations.archive')"
      :dismissible="archivingId === null"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p
          v-if="confirming"
          class="mb-2 font-medium"
        >
          {{ confirming.name }}
        </p>
        <p>{{ t('locations.confirmArchive') }}</p>
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
          {{ t('locations.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="archivingId !== null"
          @click="confirmArchive"
        >
          {{ t('locations.archive') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
