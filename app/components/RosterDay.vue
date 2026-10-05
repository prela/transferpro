<script setup lang="ts">
import type { Driver, RosterAssignment, Vehicle } from '../../shared'
import { calendarDateInTimeZone, driverListSchema, isCalendarDate, rosterDaySchema, setRosterResultSchema, vehicleListSchema } from '../../shared'

const props = defineProps<{
  timeZone: string
}>()

const { t } = useI18n()

const drivers = ref<Driver[]>([])
const vehicles = ref<Vehicle[]>([])
const assignments = ref<RosterAssignment[]>([])
const choices = reactive<Record<string, string | undefined>>({})
const rosterDate = ref(calendarDateInTimeZone(props.timeZone, new Date()))
const loading = ref(true)
const loadError = ref(false)
const pendingId = ref<string | null>(null)
const errorKey = ref<RosterFailure | null>(null)
const saved = ref(false)

// A slower reload must not replace the rows from a newer date.
let loadTicket = 0

const activeVehicles = computed(() => vehicles.value.filter(vehicle => vehicle.archivedAt === null))
const vehicleItems = computed(() => activeVehicles.value.map(vehicle => ({
  label: vehicle.registrationPlate,
  value: vehicle.id,
})))

type RosterFailure
  = 'roster.loadFailed'
    | 'roster.vehicleTaken'
    | 'roster.vehicleArchived'
    | 'roster.driverTaken'
    | 'roster.notFound'
    | 'roster.forbidden'
    | 'roster.signedOut'
    | 'roster.saveFailed'

function assignmentFor(driverId: string): RosterAssignment | null {
  return assignments.value.find(row => row.driverId === driverId) ?? null
}

function archivedPlate(driverId: string): string | null {
  const assigned = assignmentFor(driverId)
  if (!assigned)
    return null
  const vehicle = vehicles.value.find(item => item.id === assigned.vehicleId)
  if (!vehicle || vehicle.archivedAt === null)
    return null
  return vehicle.registrationPlate
}

function vehicleMissing(driverId: string): boolean {
  const assigned = assignmentFor(driverId)
  if (!assigned)
    return false
  return !vehicles.value.some(item => item.id === assigned.vehicleId)
}

function syncChoice(driverId: string) {
  const assigned = assignmentFor(driverId)
  if (!assigned) {
    choices[driverId] = undefined
    return
  }
  const vehicle = vehicles.value.find(item => item.id === assigned.vehicleId)
  // An archived Vehicle stays visible as text. The picker does not re-select it.
  choices[driverId] = vehicle && vehicle.archivedAt === null ? assigned.vehicleId : undefined
}

function dirty(driverId: string): boolean {
  const choice = choices[driverId]
  if (!choice)
    return false
  const assigned = assignmentFor(driverId)
  const vehicle = assigned ? vehicles.value.find(item => item.id === assigned.vehicleId) : undefined
  const current = vehicle && vehicle.archivedAt === null ? vehicle.id : undefined
  return choice !== current
}

async function loadAll() {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = false
  errorKey.value = null
  try {
    const [driverList, vehicleList] = await Promise.all([
      driverListSchema.parse(await $fetch('/api/drivers')),
      vehicleListSchema.parse(await $fetch('/api/vehicles', { query: { includeArchived: 'true' } })),
    ])
    if (ticket !== loadTicket)
      return
    drivers.value = driverList.drivers
    vehicles.value = vehicleList.vehicles
    await loadDay(ticket)
  }
  catch {
    if (ticket !== loadTicket)
      return
    loadError.value = true
    loading.value = false
  }
}

async function loadDay(ticket = ++loadTicket) {
  if (!isCalendarDate(rosterDate.value))
    return
  loading.value = true
  loadError.value = false
  try {
    const day = rosterDaySchema.parse(await $fetch('/api/roster', { query: { date: rosterDate.value } }))
    if (ticket !== loadTicket)
      return
    assignments.value = day.assignments
    for (const driver of drivers.value)
      syncChoice(driver.id)
  }
  catch {
    if (ticket !== loadTicket)
      return
    loadError.value = true
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

async function write(driverId: string, vehicleId: string | null) {
  if (!isCalendarDate(rosterDate.value))
    return
  pendingId.value = driverId
  errorKey.value = null
  saved.value = false
  try {
    const result = setRosterResultSchema.parse(await $fetch('/api/roster', {
      method: 'PUT',
      body: { rosterDate: rosterDate.value, driverId, vehicleId },
    }))
    const rest = assignments.value.filter(row => row.driverId !== driverId)
    assignments.value = result.assignment ? [...rest, result.assignment] : rest
    syncChoice(driverId)
    saved.value = true
  }
  catch (error) {
    errorKey.value = failureKey(error)
  }
  finally {
    pendingId.value = null
  }
}

function save(driverId: string) {
  const vehicleId = choices[driverId]
  if (!vehicleId)
    return
  void write(driverId, vehicleId)
}

function clear(driverId: string) {
  void write(driverId, null)
}

function failureKey(error: unknown): RosterFailure {
  const code = rosterErrorCode(error)
  if (code === 'roster_vehicle_taken')
    return 'roster.vehicleTaken'
  if (code === 'roster_vehicle_archived')
    return 'roster.vehicleArchived'
  if (code === 'roster_driver_taken')
    return 'roster.driverTaken'
  switch (httpStatus(error)) {
    case 401: return 'roster.signedOut'
    case 403: return 'roster.forbidden'
    case 404: return 'roster.notFound'
    default: return 'roster.saveFailed'
  }
}

function rosterErrorCode(error: unknown): string | undefined {
  // $fetch puts the JSON body on error.data. createError data is { code }.
  if (typeof error !== 'object' || error === null || !('data' in error))
    return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('code' in data))
    return undefined
  return typeof data.code === 'string' ? data.code : undefined
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

watch(rosterDate, () => {
  saved.value = false
  errorKey.value = null
  void loadDay()
})

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <section>
    <UFormField
      :label="t('roster.date')"
      name="rosterDate"
      class="mb-4 max-w-xs"
      size="xl"
    >
      <UInput
        id="roster-date"
        v-model="rosterDate"
        name="rosterDate"
        type="date"
        autocomplete="off"
        class="w-full"
      />
    </UFormField>
    <p class="mb-4 text-sm text-muted">
      {{ t('roster.intro') }}
    </p>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t('roster.loadFailed')"
    />
    <UAlert
      v-if="errorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(errorKey)"
    />
    <UAlert
      v-else-if="saved"
      color="success"
      variant="subtle"
      role="status"
      class="mb-4"
      :description="t('roster.saved')"
    />
    <p
      v-if="loading"
      role="status"
    >
      {{ t('roster.loading') }}
    </p>
    <p v-else-if="drivers.length === 0">
      {{ t('roster.emptyDrivers') }}
    </p>
    <template v-else>
      <UAlert
        v-if="activeVehicles.length === 0"
        color="warning"
        variant="subtle"
        class="mb-4"
        :description="t('roster.emptyVehicles')"
      />
      <div class="flex flex-col gap-6">
        <form
          v-for="driver in drivers"
          :key="driver.id"
          class="flex flex-col gap-3"
          @submit.prevent="save(driver.id)"
        >
          <h2 class="text-lg font-semibold">
            {{ driver.name }}
          </h2>
          <p
            v-if="archivedPlate(driver.id)"
            class="text-sm text-muted"
          >
            {{ t('roster.archivedStill', { plate: archivedPlate(driver.id) }) }}
          </p>
          <p
            v-else-if="vehicleMissing(driver.id)"
            class="text-sm text-muted"
          >
            {{ t('roster.missingVehicle') }}
          </p>
          <UFormField
            :label="t('roster.vehicleFor', { name: driver.name })"
            :name="`vehicle-${driver.id}`"
            size="xl"
          >
            <USelect
              :id="`roster-vehicle-${driver.id}`"
              v-model="choices[driver.id]"
              :name="`vehicle-${driver.id}`"
              :items="vehicleItems"
              :placeholder="t('roster.chooseVehicle')"
              class="w-full"
              @update:model-value="saved = false"
            />
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton
              type="submit"
              size="xl"
              :disabled="pendingId !== null || !dirty(driver.id)"
              :loading="pendingId === driver.id"
            >
              {{ pendingId === driver.id ? t('roster.saving') : t('roster.saveFor', { name: driver.name }) }}
            </UButton>
            <UButton
              v-if="assignmentFor(driver.id)"
              type="button"
              color="neutral"
              variant="outline"
              size="xl"
              :disabled="pendingId !== null"
              @click="clear(driver.id)"
            >
              {{ t('roster.clearFor', { name: driver.name }) }}
            </UButton>
          </div>
        </form>
      </div>
    </template>
  </section>
</template>
