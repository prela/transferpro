<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import type { Vehicle, VehicleKind } from '../../shared'
import { z } from 'zod'
import { VEHICLE_KINDS, vehicleDateError, vehicleDescriptionError, vehicleDescriptionSchema, vehicleListSchema, vehiclePlateError, vehicleSchema } from '../../shared'

const { t, locale } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const listTitleId = useId()

const vehicles = ref<Vehicle[]>([])
const includeArchived = ref(false)
const loading = ref(false)
const loadErrorKey = ref<VehicleFailure | null>(null)
const formErrorKey = ref<VehicleFailure | null>(null)
const archiveErrorKey = ref<VehicleFailure | null>(null)
const saving = ref(false)
const archivingId = ref<string | null>(null)

/**
 * Add and correct share one slideover. Archive stays a separate confirm:
 * POST /api/vehicles/:id/archive already exists.
 */
const formMode = ref<'add' | 'edit' | null>(null)
const editingId = ref<string | null>(null)
const archiveTarget = ref<Vehicle | null>(null)
const state = reactive<{
  registrationPlate: string
  kind?: VehicleKind
  registrationExpiresOn: string
  technicalInspectionExpiresOn: string
  insuranceExpiresOn: string
  description: string
}>({
  registrationPlate: '',
  registrationExpiresOn: '',
  technicalInspectionExpiresOn: '',
  insuranceExpiresOn: '',
  description: '',
})

type VehicleFailure = 'vehicles.loadFailed' | 'vehicles.rejected' | 'vehicles.notFound' | 'vehicles.forbidden' | 'vehicles.signedOut' | 'vehicles.saveFailed' | 'vehicles.plateTaken' | 'vehicles.plateArchived' | 'vehicles.archivedLocked'
interface VehicleForm {
  registrationPlate: string
  kind: VehicleKind
  registrationExpiresOn: string
  technicalInspectionExpiresOn: string
  insuranceExpiresOn: string
  description: string
}

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

/** Messages follow the active Locale. Bounds stay in the shared plate, date, and description checks. */
const schema = computed(() => z.object({
  registrationPlate: z.string().superRefine((value, ctx) => {
    const problem = vehiclePlateError(value)
    if (problem === 'empty')
      ctx.addIssue({ code: 'custom', message: t('vehicles.plateEmpty') })
    else if (problem === 'too-long')
      ctx.addIssue({ code: 'custom', message: t('vehicles.plateTooLong') })
  }),
  kind: z.enum(VEHICLE_KINDS, { error: t('vehicles.kindInvalid') }),
  registrationExpiresOn: z.string().superRefine((value, ctx) => {
    if (vehicleDateError(value))
      ctx.addIssue({ code: 'custom', message: t('vehicles.dateInvalid') })
  }),
  technicalInspectionExpiresOn: z.string().superRefine((value, ctx) => {
    if (vehicleDateError(value))
      ctx.addIssue({ code: 'custom', message: t('vehicles.dateInvalid') })
  }),
  insuranceExpiresOn: z.string().superRefine((value, ctx) => {
    if (vehicleDateError(value))
      ctx.addIssue({ code: 'custom', message: t('vehicles.dateInvalid') })
  }),
  description: z.string().superRefine((value, ctx) => {
    if (vehicleDescriptionError(value))
      ctx.addIssue({ code: 'custom', message: t('vehicles.descriptionTooLong') })
  }),
}))

const formOpen = computed({
  get: () => formMode.value !== null,
  set(open: boolean) {
    if (!open && !saving.value)
      formMode.value = null
  },
})

const archiveOpen = computed({
  get: () => archiveTarget.value !== null,
  set(open: boolean) {
    if (!open && archivingId.value === null)
      archiveTarget.value = null
  },
})

const formTitle = computed(() => formMode.value === 'edit' ? t('vehicles.edit') : t('vehicles.add'))
const submitLabel = computed(() => {
  if (saving.value)
    return formMode.value === 'edit' ? t('vehicles.saving') : t('vehicles.submitting')
  return formMode.value === 'edit' ? t('vehicles.save') : t('vehicles.submit')
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
  // $fetch puts the JSON body on error.data. The handler forwards { code }.
  if (typeof error !== 'object' || error === null || !('data' in error))
    return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('code' in data))
    return undefined
  return typeof data.code === 'string' ? data.code : undefined
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

function vehicleActions(vehicle: Vehicle): DropdownMenuItem[][] {
  return [[
    {
      label: t('vehicles.edit'),
      icon: 'i-lucide-pencil',
      onSelect: () => openEdit(vehicle),
    },
    {
      label: t('vehicles.archive'),
      icon: 'i-lucide-archive',
      onSelect: () => askArchive(vehicle),
    },
  ]]
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

function resetForm() {
  state.registrationPlate = ''
  state.kind = undefined
  state.registrationExpiresOn = ''
  state.technicalInspectionExpiresOn = ''
  state.insuranceExpiresOn = ''
  state.description = ''
  formErrorKey.value = null
}

function openAdd() {
  editingId.value = null
  resetForm()
  formMode.value = 'add'
}

function openEdit(vehicle: Vehicle) {
  editingId.value = vehicle.id
  state.registrationPlate = vehicle.registrationPlate
  state.kind = vehicle.kind
  state.registrationExpiresOn = vehicle.registrationExpiresOn
  state.technicalInspectionExpiresOn = vehicle.technicalInspectionExpiresOn
  state.insuranceExpiresOn = vehicle.insuranceExpiresOn
  state.description = vehicle.description ?? ''
  formErrorKey.value = null
  formMode.value = 'edit'
}

function vehicleBody(data: VehicleForm) {
  return {
    registrationPlate: data.registrationPlate,
    kind: data.kind,
    registrationExpiresOn: data.registrationExpiresOn,
    technicalInspectionExpiresOn: data.technicalInspectionExpiresOn,
    insuranceExpiresOn: data.insuranceExpiresOn,
    // Blank becomes null. The stored description is never an empty string.
    description: vehicleDescriptionSchema.parse(data.description),
  }
}

async function onSubmit(event: FormSubmitEvent<VehicleForm>) {
  formErrorKey.value = null
  saving.value = true
  try {
    const body = vehicleBody(event.data)
    if (formMode.value === 'edit') {
      const id = editingId.value
      if (!id)
        return
      vehicleSchema.parse(await $fetch(`/api/vehicles/${id}`, {
        method: 'PATCH',
        body,
      }))
    }
    else {
      vehicleSchema.parse(await $fetch('/api/vehicles', {
        method: 'POST',
        body,
      }))
    }
    formMode.value = null
    notifyAuditChanged()
    await loadVehicles()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

function askArchive(vehicle: Vehicle) {
  archiveErrorKey.value = null
  archiveTarget.value = vehicle
}

async function confirmArchive() {
  const vehicle = archiveTarget.value
  if (!vehicle || archivingId.value)
    return
  archivingId.value = vehicle.id
  archiveErrorKey.value = null
  try {
    vehicleSchema.parse(await $fetch(`/api/vehicles/${vehicle.id}/archive`, { method: 'POST' }))
    archiveTarget.value = null
    notifyAuditChanged()
    await loadVehicles()
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

onMounted(() => {
  void loadVehicles()
})
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
      {{ t('vehicles.add') }}
    </UButton>

    <h2
      :id="listTitleId"
      class="mb-4 text-xl font-semibold"
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
        :loading="loading"
        class="whitespace-nowrap"
      >
        <template #kind-cell="{ row }">
          {{ t(`vehicles.kinds.${row.original.kind}`) }}
        </template>
        <template #registration-cell="{ row }">
          {{ formatDay(row.original.registrationExpiresOn) }}
        </template>
        <template #registrationPlate-cell="{ row }">
          <span class="font-mono">{{ row.original.registrationPlate }}</span>
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
        <template #actions-header>
          <span class="sr-only">{{ t('vehicles.actions') }}</span>
        </template>
        <template #actions-cell="{ row }">
          <UDropdownMenu
            v-if="row.original.archivedAt === null"
            :items="vehicleActions(row.original)"
            size="xl"
          >
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              icon="i-lucide-ellipsis-vertical"
              :aria-label="t('vehicles.actionsFor', { name: row.original.registrationPlate })"
            />
          </UDropdownMenu>
        </template>
        <template #loading>
          <div
            role="status"
            class="space-y-2 py-2"
          >
            <p>{{ t('vehicles.loading') }}</p>
            <USkeleton class="h-8 w-full" />
            <USkeleton class="h-8 w-full" />
          </div>
        </template>
        <template #empty>
          <UEmpty
            :title="t('vehicles.empty')"
            icon="i-lucide-car"
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
          id="vehicle-form"
          :schema="schema"
          :state="state"
          :validate-on="[]"
          class="space-y-4"
          @submit="onSubmit"
          @error="formErrorKey = null"
        >
          <UFormField
            :label="t('vehicles.registrationPlate')"
            name="registrationPlate"
            size="xl"
          >
            <UInput
              v-model="state.registrationPlate"
              name="registrationPlate"
              type="text"
              autocomplete="off"
              class="w-full font-mono"
            />
            <template #error="{ error }">
              <span
                v-if="error"
                role="alert"
              >{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('vehicles.kind')"
            name="kind"
            size="xl"
          >
            <USelect
              v-model="state.kind"
              name="kind"
              :items="kindItems"
              :placeholder="t('vehicles.chooseKind')"
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
            :label="t('vehicles.registrationExpiresOn')"
            name="registrationExpiresOn"
            size="xl"
          >
            <UInput
              v-model="state.registrationExpiresOn"
              name="registrationExpiresOn"
              type="date"
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
            :label="t('vehicles.technicalInspectionExpiresOn')"
            name="technicalInspectionExpiresOn"
            size="xl"
          >
            <UInput
              v-model="state.technicalInspectionExpiresOn"
              name="technicalInspectionExpiresOn"
              type="date"
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
            :label="t('vehicles.insuranceExpiresOn')"
            name="insuranceExpiresOn"
            size="xl"
          >
            <UInput
              v-model="state.insuranceExpiresOn"
              name="insuranceExpiresOn"
              type="date"
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
            :label="t('vehicles.description')"
            name="description"
            size="xl"
          >
            <UInput
              v-model="state.description"
              name="description"
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
          {{ t('vehicles.cancel') }}
        </UButton>
        <UButton
          type="submit"
          form="vehicle-form"
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
      :title="t('vehicles.archive')"
      :dismissible="archivingId === null"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <p
          v-if="archiveTarget"
          class="mb-2 font-medium"
        >
          {{ archiveTarget.registrationPlate }}
        </p>
        <p>{{ t('vehicles.confirmArchive') }}</p>
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
          {{ t('vehicles.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="archivingId !== null"
          @click="confirmArchive"
        >
          {{ t('vehicles.archive') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
