<script setup lang="ts">
import type { Vehicle, VehicleKind } from '../../shared'
import { vehicleDateError, vehicleDescriptionError, vehicleKindError, vehicleListSchema, vehiclePlateError, vehicleSchema } from '../../shared'

const { t, locale } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()
const listTitleId = useId()

const vehicles = ref<Vehicle[]>([])
const includeArchived = ref(false)
const loading = ref(false)
const loadErrorKey = ref<VehicleFailure | null>(null)
const formErrorKey = ref<VehicleFailure | null>(null)
const pending = ref(false)
const archivingId = ref<string | null>(null)

const registrationPlate = ref('')
const kind = ref<VehicleKind>()
const registrationExpiresOn = ref('')
const technicalInspectionExpiresOn = ref('')
const insuranceExpiresOn = ref('')
const description = ref('')
const plateErrorKey = ref<PlateErrorKey | null>(null)
const kindErrorKey = ref<'vehicles.kindInvalid' | null>(null)
const registrationErrorKey = ref<'vehicles.dateInvalid' | null>(null)
const technicalErrorKey = ref<'vehicles.dateInvalid' | null>(null)
const insuranceErrorKey = ref<'vehicles.dateInvalid' | null>(null)
const descriptionErrorKey = ref<'vehicles.descriptionTooLong' | null>(null)

const editing = ref<Vehicle | null>(null)
const editPlate = ref('')
const editKind = ref<VehicleKind>()
const editRegistration = ref('')
const editTechnical = ref('')
const editInsurance = ref('')
const editDescription = ref('')
const editPlateErrorKey = ref<PlateErrorKey | null>(null)
const editKindErrorKey = ref<'vehicles.kindInvalid' | null>(null)
const editRegistrationErrorKey = ref<'vehicles.dateInvalid' | null>(null)
const editTechnicalErrorKey = ref<'vehicles.dateInvalid' | null>(null)
const editInsuranceErrorKey = ref<'vehicles.dateInvalid' | null>(null)
const editDescriptionErrorKey = ref<'vehicles.descriptionTooLong' | null>(null)
const editErrorKey = ref<VehicleFailure | null>(null)
const saving = ref(false)

type PlateErrorKey = 'vehicles.plateEmpty' | 'vehicles.plateTooLong'
type VehicleFailure = 'vehicles.loadFailed' | 'vehicles.rejected' | 'vehicles.notFound' | 'vehicles.forbidden' | 'vehicles.signedOut' | 'vehicles.saveFailed' | 'vehicles.plateTaken' | 'vehicles.plateArchived' | 'vehicles.archivedLocked'

const kindItems = computed(() => [
  { label: t('vehicles.kinds.fixed'), value: 'fixed' as const },
  { label: t('vehicles.kinds.occasional'), value: 'occasional' as const },
])

const columns = computed(() => [
  { accessorKey: 'registrationPlate' as const, header: t('vehicles.registrationPlate') },
  { accessorKey: 'description' as const, header: t('vehicles.description') },
  { id: 'kind', header: t('vehicles.kind') },
  { id: 'registration', header: t('vehicles.registrationExpiresOn') },
  { id: 'technical', header: t('vehicles.technicalInspectionExpiresOn') },
  { id: 'insurance', header: t('vehicles.insuranceExpiresOn') },
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

function failureKey(error: unknown): VehicleFailure {
  if (vehicleErrorCode(error) === 'vehicle_archived_plate')
    return 'vehicles.plateArchived'
  if (vehicleErrorCode(error) === 'vehicle_archived')
    return 'vehicles.archivedLocked'
  switch (httpStatus(error)) {
    case 400: return 'vehicles.rejected'
    case 401: return 'vehicles.signedOut'
    case 403: return 'vehicles.forbidden'
    case 404: return 'vehicles.notFound'
    case 409: return 'vehicles.plateTaken'
    default: return 'vehicles.saveFailed'
  }
}

function vehicleErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('data' in error && typeof error.data === 'object' && error.data !== null && 'code' in error.data) {
    const code = error.data.code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function plateKey(value: string): PlateErrorKey | null {
  const problem = vehiclePlateError(value)
  if (problem === 'empty')
    return 'vehicles.plateEmpty'
  if (problem === 'too-long')
    return 'vehicles.plateTooLong'
  return null
}

/** The column is a calendar date. Format the parts so a zone cannot shift the day. */
function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day)
    return iso
  if (locale.value === 'hr')
    return `${Number(day)}.${Number(month)}.${year}.`
  return `${day}/${month}/${year}`
}

async function loadVehicles() {
  loading.value = true
  loadErrorKey.value = null
  try {
    const query = includeArchived.value ? '?includeArchived=true' : ''
    const next = vehicleListSchema.parse(await $fetch(`/api/vehicles${query}`)).vehicles
    vehicles.value = next
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'vehicles.saveFailed' ? 'vehicles.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

async function addVehicle() {
  const chosen = kind.value
  plateErrorKey.value = plateKey(registrationPlate.value)
  kindErrorKey.value = vehicleKindError(chosen ?? '') ? 'vehicles.kindInvalid' : null
  registrationErrorKey.value = vehicleDateError(registrationExpiresOn.value) ? 'vehicles.dateInvalid' : null
  technicalErrorKey.value = vehicleDateError(technicalInspectionExpiresOn.value) ? 'vehicles.dateInvalid' : null
  insuranceErrorKey.value = vehicleDateError(insuranceExpiresOn.value) ? 'vehicles.dateInvalid' : null
  descriptionErrorKey.value = vehicleDescriptionError(description.value) ? 'vehicles.descriptionTooLong' : null
  formErrorKey.value = null
  if (plateErrorKey.value || kindErrorKey.value || registrationErrorKey.value || technicalErrorKey.value || insuranceErrorKey.value || descriptionErrorKey.value || chosen === undefined)
    return
  pending.value = true
  try {
    vehicleSchema.parse(await $fetch('/api/vehicles', {
      method: 'POST',
      body: {
        registrationPlate: registrationPlate.value,
        kind: chosen,
        registrationExpiresOn: registrationExpiresOn.value,
        technicalInspectionExpiresOn: technicalInspectionExpiresOn.value,
        insuranceExpiresOn: insuranceExpiresOn.value,
        description: description.value,
      },
    }))
    registrationPlate.value = ''
    kind.value = undefined
    description.value = ''
    registrationExpiresOn.value = ''
    technicalInspectionExpiresOn.value = ''
    insuranceExpiresOn.value = ''
    notifyAuditChanged()
    await loadVehicles()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    pending.value = false
  }
}

function openEdit(vehicle: Vehicle) {
  editing.value = vehicle
  editPlate.value = vehicle.registrationPlate
  editKind.value = vehicle.kind
  editRegistration.value = vehicle.registrationExpiresOn
  editTechnical.value = vehicle.technicalInspectionExpiresOn
  editInsurance.value = vehicle.insuranceExpiresOn
  editDescription.value = vehicle.description ?? ''
  editPlateErrorKey.value = null
  editKindErrorKey.value = null
  editRegistrationErrorKey.value = null
  editTechnicalErrorKey.value = null
  editInsuranceErrorKey.value = null
  editDescriptionErrorKey.value = null
  editErrorKey.value = null
}

async function saveEdit() {
  const current = editing.value
  const chosen = editKind.value
  if (!current)
    return
  editPlateErrorKey.value = plateKey(editPlate.value)
  editKindErrorKey.value = vehicleKindError(chosen ?? '') ? 'vehicles.kindInvalid' : null
  editRegistrationErrorKey.value = vehicleDateError(editRegistration.value) ? 'vehicles.dateInvalid' : null
  editTechnicalErrorKey.value = vehicleDateError(editTechnical.value) ? 'vehicles.dateInvalid' : null
  editInsuranceErrorKey.value = vehicleDateError(editInsurance.value) ? 'vehicles.dateInvalid' : null
  editDescriptionErrorKey.value = vehicleDescriptionError(editDescription.value) ? 'vehicles.descriptionTooLong' : null
  editErrorKey.value = null
  if (editPlateErrorKey.value || editKindErrorKey.value || editRegistrationErrorKey.value || editTechnicalErrorKey.value || editInsuranceErrorKey.value || editDescriptionErrorKey.value || chosen === undefined)
    return
  saving.value = true
  try {
    vehicleSchema.parse(await $fetch(`/api/vehicles/${current.id}`, {
      method: 'PATCH',
      body: {
        registrationPlate: editPlate.value,
        kind: chosen,
        registrationExpiresOn: editRegistration.value,
        technicalInspectionExpiresOn: editTechnical.value,
        insuranceExpiresOn: editInsurance.value,
        description: editDescription.value,
      },
    }))
    editing.value = null
    notifyAuditChanged()
    await loadVehicles()
  }
  catch (error) {
    editErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

async function archiveVehicle(vehicle: Vehicle) {
  archivingId.value = vehicle.id
  loadErrorKey.value = null
  try {
    vehicleSchema.parse(await $fetch(`/api/vehicles/${vehicle.id}/archive`, { method: 'POST' }))
    notifyAuditChanged()
    await loadVehicles()
  }
  catch (error) {
    loadErrorKey.value = failureKey(error)
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

onMounted(() => {
  void loadVehicles()
})
</script>

<template>
  <section>
    <h2
      :id="titleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t('vehicles.add') }}
    </h2>
    <UAlert
      v-if="formErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(formErrorKey)"
    />
    <form @submit.prevent="addVehicle">
      <UFormField
        :label="t('vehicles.registrationPlate')"
        name="registrationPlate"
        class="mb-4"
        size="xl"
        :error="plateErrorKey ? t(plateErrorKey) : false"
      >
        <UInput
          id="vehicle-plate"
          v-model="registrationPlate"
          name="registrationPlate"
          type="text"
          autocomplete="off"
          class="w-full"
          @update:model-value="plateErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('vehicles.kind')"
        name="kind"
        class="mb-4"
        size="xl"
        :error="kindErrorKey ? t(kindErrorKey) : false"
      >
        <USelect
          id="vehicle-kind"
          v-model="kind"
          name="kind"
          :items="kindItems"
          :placeholder="t('vehicles.chooseKind')"
          class="w-full"
          @update:model-value="kindErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('vehicles.registrationExpiresOn')"
        name="registration"
        class="mb-4"
        size="xl"
        :error="registrationErrorKey ? t(registrationErrorKey) : false"
      >
        <UInput
          id="vehicle-registration"
          v-model="registrationExpiresOn"
          name="registration"
          type="date"
          autocomplete="off"
          class="w-full"
          @update:model-value="registrationErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('vehicles.technicalInspectionExpiresOn')"
        name="technical"
        class="mb-4"
        size="xl"
        :error="technicalErrorKey ? t(technicalErrorKey) : false"
      >
        <UInput
          id="vehicle-technical"
          v-model="technicalInspectionExpiresOn"
          name="technical"
          type="date"
          autocomplete="off"
          class="w-full"
          @update:model-value="technicalErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('vehicles.insuranceExpiresOn')"
        name="insurance"
        class="mb-4"
        size="xl"
        :error="insuranceErrorKey ? t(insuranceErrorKey) : false"
      >
        <UInput
          id="vehicle-insurance"
          v-model="insuranceExpiresOn"
          name="insurance"
          type="date"
          autocomplete="off"
          class="w-full"
          @update:model-value="insuranceErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('vehicles.description')"
        name="description"
        class="mb-4"
        size="xl"
        :error="descriptionErrorKey ? t(descriptionErrorKey) : false"
      >
        <UInput
          id="vehicle-description"
          v-model="description"
          name="description"
          type="text"
          autocomplete="off"
          class="w-full"
          @update:model-value="descriptionErrorKey = null"
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
        {{ pending ? t('vehicles.submitting') : t('vehicles.submit') }}
      </UButton>
    </form>

    <h2
      :id="listTitleId"
      class="mt-8 mb-4 text-xl font-semibold"
    >
      {{ t('vehicles.title') }}
    </h2>
    <UCheckbox
      id="vehicle-show-archived"
      v-model="includeArchived"
      name="show-archived"
      size="xl"
      class="mb-4"
      :label="t('vehicles.showArchived')"
      @update:model-value="loadVehicles()"
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
      {{ t('vehicles.loading') }}
    </p>
    <p v-else-if="vehicles.length === 0">
      {{ t('vehicles.empty') }}
    </p>
    <div
      v-else
      class="overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      role="region"
      :aria-labelledby="listTitleId"
      tabindex="0"
    >
      <UTable
        :data="vehicles"
        :columns="columns"
        class="whitespace-nowrap"
      >
        <template #kind-cell="{ row }">
          {{ t(`vehicles.kinds.${row.original.kind}`) }}
        </template>
        <template #registration-cell="{ row }">
          {{ formatDay(row.original.registrationExpiresOn) }}
        </template>
        <template #technical-cell="{ row }">
          {{ formatDay(row.original.technicalInspectionExpiresOn) }}
        </template>
        <template #insurance-cell="{ row }">
          {{ formatDay(row.original.insuranceExpiresOn) }}
        </template>
        <template #status-cell="{ row }">
          {{ row.original.archivedAt ? t('vehicles.archived') : '' }}
        </template>
        <template #actions-cell="{ row }">
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="row.original.archivedAt === null"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :aria-label="`${t('vehicles.edit')}: ${row.original.registrationPlate}`"
              @click="openEdit(row.original)"
            >
              {{ t('vehicles.edit') }}
            </UButton>
            <UButton
              v-if="row.original.archivedAt === null"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :disabled="archivingId === row.original.id"
              :aria-label="`${t('vehicles.archive')}: ${row.original.registrationPlate}`"
              @click="archiveVehicle(row.original)"
            >
              {{ t('vehicles.archive') }}
            </UButton>
          </div>
        </template>
      </UTable>
    </div>

    <UModal
      v-model:open="editOpen"
      :title="t('vehicles.edit')"
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
          id="vehicle-edit"
          @submit.prevent="saveEdit"
        >
          <UFormField
            :label="t('vehicles.registrationPlate')"
            name="edit-plate"
            class="mb-4"
            size="xl"
            :error="editPlateErrorKey ? t(editPlateErrorKey) : false"
          >
            <UInput
              id="vehicle-edit-plate"
              v-model="editPlate"
              name="edit-plate"
              type="text"
              autocomplete="off"
              class="w-full"
              @update:model-value="editPlateErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('vehicles.kind')"
            name="edit-kind"
            class="mb-4"
            size="xl"
            :error="editKindErrorKey ? t(editKindErrorKey) : false"
          >
            <USelect
              id="vehicle-edit-kind"
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
            :label="t('vehicles.registrationExpiresOn')"
            name="edit-registration"
            class="mb-4"
            size="xl"
            :error="editRegistrationErrorKey ? t(editRegistrationErrorKey) : false"
          >
            <UInput
              id="vehicle-edit-registration"
              v-model="editRegistration"
              name="edit-registration"
              type="date"
              autocomplete="off"
              class="w-full"
              @update:model-value="editRegistrationErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('vehicles.technicalInspectionExpiresOn')"
            name="edit-technical"
            class="mb-4"
            size="xl"
            :error="editTechnicalErrorKey ? t(editTechnicalErrorKey) : false"
          >
            <UInput
              id="vehicle-edit-technical"
              v-model="editTechnical"
              name="edit-technical"
              type="date"
              autocomplete="off"
              class="w-full"
              @update:model-value="editTechnicalErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('vehicles.insuranceExpiresOn')"
            name="edit-insurance"
            class="mb-4"
            size="xl"
            :error="editInsuranceErrorKey ? t(editInsuranceErrorKey) : false"
          >
            <UInput
              id="vehicle-edit-insurance"
              v-model="editInsurance"
              name="edit-insurance"
              type="date"
              autocomplete="off"
              class="w-full"
              @update:model-value="editInsuranceErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('vehicles.description')"
            name="edit-description"
            class="mb-4"
            size="xl"
            :error="editDescriptionErrorKey ? t(editDescriptionErrorKey) : false"
          >
            <UInput
              id="vehicle-edit-description"
              v-model="editDescription"
              name="edit-description"
              type="text"
              autocomplete="off"
              class="w-full"
              @update:model-value="editDescriptionErrorKey = null"
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
          {{ t('vehicles.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="saving"
          @click="saveEdit"
        >
          {{ saving ? t('vehicles.saving') : t('vehicles.save') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
