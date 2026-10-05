<script setup lang="ts">
import type { Location, LocationKind } from '../../shared'
import { locationAddressError, locationKindError, locationListSchema, locationNameError, locationSchema } from '../../shared'

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()
const listTitleId = useId()

const locations = ref<Location[]>([])
const includeArchived = ref(false)
const loading = ref(false)
const loadErrorKey = ref<LocationFailure | null>(null)
const formErrorKey = ref<LocationFailure | null>(null)
const name = ref('')
const kind = ref<LocationKind>()
const address = ref('')
const nameErrorKey = ref<NameErrorKey | null>(null)
const kindErrorKey = ref<'locations.kindInvalid' | null>(null)
const addressErrorKey = ref<'locations.addressTooLong' | null>(null)
const pending = ref(false)
const archivingId = ref<string | null>(null)

const editing = ref<Location | null>(null)
const editName = ref('')
const editKind = ref<LocationKind>()
const editAddress = ref('')
const editNameErrorKey = ref<NameErrorKey | null>(null)
const editKindErrorKey = ref<'locations.kindInvalid' | null>(null)
const editAddressErrorKey = ref<'locations.addressTooLong' | null>(null)
const editErrorKey = ref<LocationFailure | null>(null)
const saving = ref(false)

type NameErrorKey = 'locations.nameEmpty' | 'locations.nameTooLong'
type LocationFailure = 'locations.loadFailed' | 'locations.rejected' | 'locations.notFound' | 'locations.forbidden' | 'locations.signedOut' | 'locations.saveFailed' | 'locations.archivedLocked'

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
  { id: 'status', header: '' },
  { id: 'actions', header: '' },
])

const editOpen = computed({
  get: () => editing.value !== null,
  set(open: boolean) {
    if (!open && !saving.value)
      editing.value = null
  },
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

function nameKey(value: string): NameErrorKey | null {
  const problem = locationNameError(value)
  if (problem === 'empty')
    return 'locations.nameEmpty'
  if (problem === 'too-long')
    return 'locations.nameTooLong'
  return null
}

function addressKey(value: string): 'locations.addressTooLong' | null {
  return locationAddressError(value) ? 'locations.addressTooLong' : null
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

async function addLocation() {
  const chosen = kind.value
  nameErrorKey.value = nameKey(name.value)
  kindErrorKey.value = locationKindError(chosen ?? '') ? 'locations.kindInvalid' : null
  addressErrorKey.value = addressKey(address.value)
  formErrorKey.value = null
  if (nameErrorKey.value || kindErrorKey.value || addressErrorKey.value || chosen === undefined)
    return
  pending.value = true
  try {
    locationSchema.parse(await $fetch('/api/locations', {
      method: 'POST',
      body: { name: name.value, kind: chosen, address: address.value },
    }))
    name.value = ''
    kind.value = undefined
    address.value = ''
    notifyAuditChanged()
    await loadLocations()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    pending.value = false
  }
}

function openEdit(location: Location) {
  editing.value = location
  editName.value = location.name
  editKind.value = location.kind
  editAddress.value = location.address ?? ''
  editNameErrorKey.value = null
  editKindErrorKey.value = null
  editAddressErrorKey.value = null
  editErrorKey.value = null
}

async function saveEdit() {
  const current = editing.value
  const chosen = editKind.value
  if (!current)
    return
  editNameErrorKey.value = nameKey(editName.value)
  editKindErrorKey.value = locationKindError(chosen ?? '') ? 'locations.kindInvalid' : null
  editAddressErrorKey.value = addressKey(editAddress.value)
  editErrorKey.value = null
  if (editNameErrorKey.value || editKindErrorKey.value || editAddressErrorKey.value || chosen === undefined)
    return
  saving.value = true
  try {
    locationSchema.parse(await $fetch(`/api/locations/${current.id}`, {
      method: 'PATCH',
      body: { name: editName.value, kind: chosen, address: editAddress.value },
    }))
    editing.value = null
    notifyAuditChanged()
    await loadLocations()
  }
  catch (error) {
    editErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

async function archiveLocation(location: Location) {
  archivingId.value = location.id
  formErrorKey.value = null
  try {
    locationSchema.parse(await $fetch(`/api/locations/${location.id}/archive`, { method: 'POST' }))
    notifyAuditChanged()
    await loadLocations()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
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
    <h2
      :id="titleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t('locations.add') }}
    </h2>
    <UAlert
      v-if="formErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(formErrorKey)"
    />
    <form @submit.prevent="addLocation">
      <UFormField
        :label="t('locations.name')"
        name="name"
        class="mb-4"
        size="xl"
        :error="nameErrorKey ? t(nameErrorKey) : false"
      >
        <UInput
          id="location-name"
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
        :label="t('locations.kind')"
        name="kind"
        class="mb-4"
        size="xl"
        :error="kindErrorKey ? t(kindErrorKey) : false"
      >
        <USelect
          id="location-kind"
          v-model="kind"
          name="kind"
          :items="kindItems"
          :placeholder="t('locations.chooseKind')"
          class="w-full"
          @update:model-value="kindErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('locations.address')"
        name="address"
        class="mb-4"
        size="xl"
        :error="addressErrorKey ? t(addressErrorKey) : false"
      >
        <UInput
          id="location-address"
          v-model="address"
          name="address"
          type="text"
          autocomplete="off"
          class="w-full"
          @update:model-value="addressErrorKey = null"
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
        {{ pending ? t('locations.submitting') : t('locations.submit') }}
      </UButton>
    </form>

    <h2
      :id="listTitleId"
      class="mt-8 mb-4 text-xl font-semibold"
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
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('locations.loading') }}
    </p>
    <p v-else-if="locations.length === 0">
      {{ t('locations.empty') }}
    </p>
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
        class="whitespace-nowrap"
      >
        <template #kind-cell="{ row }">
          {{ t(`locations.kinds.${row.original.kind}`) }}
        </template>
        <template #address-cell="{ row }">
          {{ row.original.address ?? '' }}
        </template>
        <template #status-cell="{ row }">
          {{ row.original.archivedAt ? t('locations.archived') : '' }}
        </template>
        <template #actions-cell="{ row }">
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="row.original.archivedAt === null"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="`${t('locations.edit')}: ${row.original.name}`"
              @click="openEdit(row.original)"
            >
              {{ t('locations.edit') }}
            </UButton>
            <UButton
              v-if="row.original.archivedAt === null"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :loading="archivingId === row.original.id"
              :aria-label="`${t('locations.archive')}: ${row.original.name}`"
              @click="archiveLocation(row.original)"
            >
              {{ t('locations.archive') }}
            </UButton>
          </div>
        </template>
      </UTable>
    </div>

    <UModal
      v-model:open="editOpen"
      :title="t('locations.edit')"
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
          id="location-edit"
          @submit.prevent="saveEdit"
        >
          <UFormField
            :label="t('locations.name')"
            name="edit-name"
            class="mb-4"
            size="xl"
            :error="editNameErrorKey ? t(editNameErrorKey) : false"
          >
            <UInput
              id="location-edit-name"
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
            :label="t('locations.kind')"
            name="edit-kind"
            class="mb-4"
            size="xl"
            :error="editKindErrorKey ? t(editKindErrorKey) : false"
          >
            <USelect
              id="location-edit-kind"
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
          <UFormField
            :label="t('locations.address')"
            name="edit-address"
            class="mb-4"
            size="xl"
            :error="editAddressErrorKey ? t(editAddressErrorKey) : false"
          >
            <UInput
              id="location-edit-address"
              v-model="editAddress"
              name="edit-address"
              type="text"
              autocomplete="off"
              class="w-full"
              @update:model-value="editAddressErrorKey = null"
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
          {{ t('locations.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="saving"
          @click="saveEdit"
        >
          {{ saving ? t('locations.saving') : t('locations.save') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
