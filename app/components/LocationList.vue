<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import type { AddressSuggestion, Location, LocationKind, LocationPlace } from '../../shared'
import { z } from 'zod'
import { catalogSearchMatches, LOCATION_ADDRESS_MAX_LENGTH, LOCATION_KINDS, LOCATION_NAME_MAX_LENGTH, LOCATION_SUGGEST_MIN_LENGTH, locationAddressSchema, locationIataError, locationIataSchema, locationListSchema, locationSchema, suggestAddressesResponseSchema } from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const listTitleId = useId()
const searchId = useId()

const locations = ref<Location[]>([])
const query = ref('')
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
/** The panel title stays the name that was opened, not the half-typed correction. */
const openedName = ref('')
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

const phoneColumn = { class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }
const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('locations.name') },
  { id: 'kind', header: t('locations.kind'), meta: phoneColumn },
  { accessorKey: 'address' as const, header: t('locations.address'), meta: phoneColumn },
  // The labeled field is the airport form. This cell shows a stored code
  // and stays blank for a hotel, an address, or other kind.
  { id: 'iata', header: '', meta: phoneColumn },
  { id: 'status', header: '', meta: phoneColumn },
  { id: 'actions', header: '' },
])

const visibleLocations = computed(() => locations.value.filter(location =>
  catalogSearchMatches(query.value, [
    location.name,
    t(`locations.kinds.${location.kind}`),
    location.address ?? '',
    location.iata ?? '',
  ]),
))

/** An archived row opens for reading. The server refuses a correction. */
const archivedView = computed(() => {
  if (formMode.value !== 'edit' || editingId.value === null)
    return false
  return locations.value.find(location => location.id === editingId.value)?.archivedAt != null
})

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

const formTitle = computed(() => formMode.value === 'edit' ? openedName.value : t('locations.add'))
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
      label: t('locations.archive'),
      icon: 'i-lucide-archive',
      onSelect: () => askArchive(location),
    },
  ]]
}

function locationSecondLine(location: Location): string {
  const kind = t(`locations.kinds.${location.kind}`)
  const extra = location.archivedAt ? t('locations.archived') : (location.address ?? '')
  return extra ? `${kind} · ${extra}` : kind
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

/**
 * A lookup that is already in flight must not fill a later field.
 * The generation is what the response checks.
 */
function dropPendingSuggestions() {
  suggestGeneration += 1
  window.clearTimeout(suggestTimer)
  suggestions.value = []
  attribution.value = null
}

function resetForm() {
  state.name = ''
  state.kind = undefined
  state.address = ''
  state.iata = ''
  heldPlace.value = null
  pickedText.value = null
  sessionToken.value = null
  suggestionsUnavailable.value = false
  dropPendingSuggestions()
  formErrorKey.value = null
}

function openAdd() {
  editingId.value = null
  openedName.value = ''
  resetForm()
  formMode.value = 'add'
}

function openEdit(location: Location) {
  editingId.value = location.id
  openedName.value = location.name
  state.name = location.name
  state.kind = location.kind
  state.address = location.address ?? ''
  state.iata = location.iata ?? ''
  heldPlace.value = location.place
  pickedText.value = location.address
  sessionToken.value = null
  suggestionsUnavailable.value = false
  dropPendingSuggestions()
  formErrorKey.value = null
  formMode.value = 'edit'
}

const suggestionItems = computed(() => suggestions.value.map(suggestion => suggestion.text))

function onAddressInput(value: string | number | null | undefined) {
  const next = value == null ? '' : String(value)
  const match = suggestions.value.find(suggestion => suggestion.text === next)
  // A pick is the suggested text. Anything else, including Enter, keeps the typed address.
  if (match) {
    pickedText.value = match.text
    heldPlace.value = { provider: match.provider, placeRef: match.placeRef }
    sessionToken.value = null
    dropPendingSuggestions()
    return
  }
  if (next !== pickedText.value)
    heldPlace.value = null
  window.clearTimeout(suggestTimer)
  suggestTimer = window.setTimeout(() => {
    void lookupSuggestions()
  }, SUGGEST_PAUSE_MS)
}

/** Enter submits the typed address. It must not store the highlighted row. */
function closeSuggestionsForSubmit() {
  dropPendingSuggestions()
}

async function lookupSuggestions() {
  const text = state.address.trim()
  if (text.length < LOCATION_SUGGEST_MIN_LENGTH) {
    dropPendingSuggestions()
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
  <div>
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
          <UCheckbox
            id="location-show-archived"
            v-model="includeArchived"
            name="show-archived"
            class="mb-1 max-lg:min-h-11"
            :label="t('locations.showArchived')"
            :ui="{ label: 'max-lg:text-base' }"
            @update:model-value="loadLocations()"
          />
          <UButton
            type="button"
            icon="i-lucide-plus"
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
          {{ t('locations.title') }}
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
            :data="visibleLocations"
            :columns="columns"
            :loading="loading"
            class="whitespace-nowrap"
          >
            <template #name-cell="{ row }">
              <button
                type="button"
                class="text-left font-medium"
                @click="openEdit(row.original)"
              >
                {{ row.original.name }}
              </button>
              <p class="mt-0.5 text-sm text-muted lg:hidden">
                {{ locationSecondLine(row.original) }}
              </p>
            </template>
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
                  icon="i-lucide-ellipsis-vertical"
                  class="h-7 min-h-7 max-lg:h-11 max-lg:min-h-11"
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
                :title="query.trim() ? t('catalog.searchEmpty') : t('locations.empty')"
                icon="i-lucide-map-pin"
                variant="naked"
              />
            </template>
          </UTable>
        </div>
      </template>

      <template #body="{ phone }">
        <UAlert
          v-if="formErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mb-4"
          :description="t(formErrorKey)"
        />
        <p
          v-if="archivedView"
          class="mb-4 text-sm text-muted"
        >
          {{ t('locations.archived') }}
        </p>
        <UForm
          id="location-form"
          :schema="schema"
          :state="state"
          :validate-on="[]"
          class="space-y-4"
          :class="commandInputClass"
          @submit="onSubmit"
          @error="formErrorKey = null"
        >
          <UFormField
            :label="t('locations.name')"
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
            :label="t('locations.kind')"
            name="kind"
            :size="phone ? 'xl' : 'sm'"
          >
            <USelect
              v-model="state.kind"
              name="kind"
              :items="kindItems"
              :placeholder="t('locations.chooseKind')"
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
            :label="t('locations.address')"
            name="address"
            :size="phone ? 'xl' : 'sm'"
          >
            <UInputMenu
              v-model="state.address"
              mode="autocomplete"
              name="address"
              autocomplete="off"
              :size="phone ? 'xl' : 'sm'"
              class="w-full"
              :disabled="archivedView"
              :items="suggestionItems"
              :ignore-filter="true"
              :trailing-icon="false"
              :portal="false"
              :content="{ hideWhenEmpty: true }"
              @update:model-value="onAddressInput"
              @keydown.enter.capture="closeSuggestionsForSubmit"
            >
              <template #content-bottom>
                <p
                  v-if="attribution"
                  class="px-3 py-2 text-sm text-muted"
                >
                  {{ attribution }}
                </p>
              </template>
            </UInputMenu>
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
            :size="phone ? 'xl' : 'sm'"
          >
            <UInput
              v-model="state.iata"
              name="iata"
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
          :disabled="saving"
          @click="formOpen = false"
        >
          {{ t('locations.cancel') }}
        </UButton>
        <UButton
          v-if="!archivedView"
          type="submit"
          form="location-form"
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
  </div>
</template>
