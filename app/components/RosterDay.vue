<script setup lang="ts">
import type { Driver, RosterAssignment, RosterCopySkipReason, UnavailabilityWindowView, Vehicle } from '../../shared'
import {
  addCalendarDays,
  calendarDateInTimeZone,
  driverListSchema,
  mondayOfWeek,
  planRosterCopy,
  rosterDaySchema,
  setRosterResultSchema,
  unavailabilityListSchema,
  vehicleListSchema,
  weekDates,
  windowTouchesDate,
} from '../../shared'

const props = defineProps<{
  timeZone: string
}>()

const { t, locale } = useI18n()

const drivers = ref<Driver[]>([])
const vehicles = ref<Vehicle[]>([])
const assignmentsByDate = reactive<Record<string, RosterAssignment[]>>({})
const choices = reactive<Record<string, string | undefined>>({})
const cellState = reactive<Record<string, 'saving' | 'saved' | 'error' | undefined>>({})
const cellError = reactive<Record<string, RosterFailure | undefined>>({})
/**
 * Unavailability windows (ADR-0034) of each roster week read, keyed by its
 * Monday. Read only here: the windows are kept in the Driver and Vehicle panels.
 */
const windowsByWeek = reactive<Record<string, UnavailabilityWindowView[]>>({})

const today = calendarDateInTimeZone(props.timeZone, new Date())
const weekStart = ref(mondayOfWeek(today))
const phoneDate = ref(today)
const loading = ref(true)
const loadError = ref(false)
const copying = ref(false)
const copyResult = ref<{
  copied: number
  skipped: Array<{
    driverId: string
    rosterDate: string
    reason: RosterCopySkipReason | 'refused'
  }>
} | null>(null)

// A slower reload must not replace the rows from a newer week.
let loadTicket = 0

const week = computed(() => weekDates(weekStart.value))
const weekRangeLabel = computed(() => {
  const start = week.value[0]
  const end = week.value[6]
  if (start === undefined || end === undefined)
    return ''
  return `${dayHeading(start)} – ${dayHeading(end)}`
})
const showingThisWeek = computed(() => weekStart.value === mondayOfWeek(today))
const showingToday = computed(() => phoneDate.value === today)
const activeVehicles = computed(() => vehicles.value.filter(vehicle => vehicle.archivedAt === null))
const activeDrivers = computed(() => drivers.value.filter(driver => driver.archivedAt === null))
// An archived Driver is not a new row. A day they already have still shows their name.
const boardDrivers = computed(() => {
  const placed = new Set(
    Object.values(assignmentsByDate).flatMap(rows => rows.map(row => row.driverId)),
  )
  return drivers.value.filter(driver => driver.archivedAt === null || placed.has(driver.id))
})

type RosterFailure
  = 'roster.loadFailed'
    | 'roster.vehicleTaken'
    | 'roster.vehicleArchived'
    | 'roster.driverArchived'
    | 'roster.driverTaken'
    | 'roster.notFound'
    | 'roster.forbidden'
    | 'roster.signedOut'
    | 'roster.saveFailed'

function cellKey(driverId: string, date: string): string {
  return `${driverId}:${date}`
}

function assignmentFor(driverId: string, date: string): RosterAssignment | null {
  return assignmentsByDate[date]?.find(row => row.driverId === driverId) ?? null
}

function givenVehicleIds(date: string, exceptDriverId: string): Set<string> {
  return new Set(
    (assignmentsByDate[date] ?? [])
      .filter(row => row.driverId !== exceptDriverId)
      .map(row => row.vehicleId),
  )
}

function vehicleItems(date: string, driverId: string) {
  const given = givenVehicleIds(date, driverId)
  const away = new Set(windowsOn(date).flatMap(entry => entry.vehicleId === null ? [] : [entry.vehicleId]))
  return activeVehicles.value.map((vehicle) => {
    // The server still refuses a duplicate. The marks are only hints; a window does not block the roster.
    const marks = [
      ...(given.has(vehicle.id) ? [t('roster.given')] : []),
      ...(away.has(vehicle.id) ? [t('roster.unavailableMark')] : []),
    ]
    return {
      label: marks.length > 0 ? `${vehicle.registrationPlate} (${marks.join(', ')})` : vehicle.registrationPlate,
      value: vehicle.id,
    }
  })
}

function assignedPlate(driverId: string, date: string): string | null {
  const assigned = assignmentFor(driverId, date)
  if (!assigned)
    return null
  return vehicles.value.find(item => item.id === assigned.vehicleId)?.registrationPlate ?? null
}

function archivedPlate(driverId: string, date: string): string | null {
  const assigned = assignmentFor(driverId, date)
  if (!assigned)
    return null
  const vehicle = vehicles.value.find(item => item.id === assigned.vehicleId)
  if (!vehicle || vehicle.archivedAt === null)
    return null
  return vehicle.registrationPlate
}

function vehicleMissing(driverId: string, date: string): boolean {
  const assigned = assignmentFor(driverId, date)
  if (!assigned)
    return false
  return !vehicles.value.some(item => item.id === assigned.vehicleId)
}

function windowsOn(date: string): UnavailabilityWindowView[] {
  return (windowsByWeek[mondayOfWeek(date)] ?? []).filter(entry => windowTouchesDate(entry, date, props.timeZone))
}

function driverUnavailable(driverId: string, date: string): boolean {
  return windowsOn(date).some(entry => entry.driverId === driverId)
}

/** The Vehicle this Driver has on the roster that day is away for part of it. */
function vehicleUnavailable(driverId: string, date: string): boolean {
  const vehicleId = assignmentFor(driverId, date)?.vehicleId
  return vehicleId !== undefined && windowsOn(date).some(entry => entry.vehicleId === vehicleId)
}

function syncChoice(driverId: string, date: string) {
  const assigned = assignmentFor(driverId, date)
  const key = cellKey(driverId, date)
  if (!assigned) {
    choices[key] = undefined
    return
  }
  const vehicle = vehicles.value.find(item => item.id === assigned.vehicleId)
  // An archived Vehicle stays visible as text. The picker does not re-select it.
  choices[key] = vehicle && vehicle.archivedAt === null ? assigned.vehicleId : undefined
}

function dayHeading(iso: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00.000Z`))
}

function skipLine(row: { driverId: string, rosterDate: string, reason: RosterCopySkipReason | 'refused' }): string {
  const name = drivers.value.find(driver => driver.id === row.driverId)?.name ?? row.driverId
  const key = row.reason === 'archivedVehicle'
    ? 'roster.skipArchived'
    : row.reason === 'vehicleGiven'
      ? 'roster.skipGiven'
      : 'roster.skipRefused'
  return t(key, { name, date: row.rosterDate })
}

async function loadAll() {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = false
  try {
    const [driverList, vehicleList] = await Promise.all([
      driverListSchema.parse(await $fetch('/api/drivers', { query: { includeArchived: 'true' } })),
      vehicleListSchema.parse(await $fetch('/api/vehicles', { query: { includeArchived: 'true' } })),
    ])
    if (ticket !== loadTicket)
      return
    drivers.value = driverList.drivers
    vehicles.value = vehicleList.vehicles
    await loadDates(week.value, ticket)
  }
  catch {
    if (ticket !== loadTicket)
      return
    loadError.value = true
    loading.value = false
  }
}

async function readDates(dates: readonly string[]) {
  return Promise.all(dates.map(async (date) => {
    return rosterDaySchema.parse(await $fetch('/api/roster', { query: { date } }))
  }))
}

async function readWindows(dates: readonly string[]) {
  const mondays = [...new Set(dates.map(date => mondayOfWeek(date)))]
  return Promise.all(mondays.map(async week => ({
    week,
    windows: unavailabilityListSchema.parse(await $fetch('/api/unavailability', { query: { week } })).windows,
  })))
}

function applyDays(days: readonly { rosterDate: string, assignments: RosterAssignment[] }[]) {
  for (const day of days) {
    assignmentsByDate[day.rosterDate] = day.assignments
    for (const driver of drivers.value)
      syncChoice(driver.id, day.rosterDate)
  }
}

async function loadDates(dates: readonly string[], ticket = ++loadTicket) {
  loading.value = true
  loadError.value = false
  try {
    const [days, weeks] = await Promise.all([readDates(dates), readWindows(dates)])
    if (ticket !== loadTicket)
      return
    applyDays(days)
    for (const read of weeks)
      windowsByWeek[read.week] = read.windows
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

async function write(driverId: string, rosterDate: string, vehicleId: string | null): Promise<boolean> {
  const key = cellKey(driverId, rosterDate)
  cellState[key] = 'saving'
  cellError[key] = undefined
  try {
    const result = setRosterResultSchema.parse(await $fetch('/api/roster', {
      method: 'PUT',
      body: { rosterDate, driverId, vehicleId },
    }))
    const rest = (assignmentsByDate[rosterDate] ?? []).filter(row => row.driverId !== driverId)
    assignmentsByDate[rosterDate] = result.assignment ? [...rest, result.assignment] : rest
    syncChoice(driverId, rosterDate)
    cellState[key] = 'saved'
    return true
  }
  catch (error) {
    // Revert the picker so a later choice of the same Vehicle still saves.
    syncChoice(driverId, rosterDate)
    cellState[key] = 'error'
    cellError[key] = failureKey(error)
    return false
  }
}

function pick(driverId: string, date: string, vehicleId: string | undefined | null) {
  const key = cellKey(driverId, date)
  const assigned = assignmentFor(driverId, date)
  const current = assigned && vehicles.value.find(item => item.id === assigned.vehicleId)?.archivedAt === null
    ? assigned.vehicleId
    : undefined
  const next = vehicleId ?? undefined
  if (next === current)
    return
  choices[key] = next
  if (!next) {
    if (assigned)
      void write(driverId, date, null)
    return
  }
  void write(driverId, date, next)
}

function cellErrorText(driverId: string, date: string): string | undefined {
  const key = cellError[cellKey(driverId, date)]
  return key ? t(key) : undefined
}

function clear(driverId: string, date: string) {
  void write(driverId, date, null)
}

async function copyLastWeek() {
  copyResult.value = null
  copying.value = true
  const previous = weekDates(addCalendarDays(weekStart.value, -7))
  try {
    applyDays(await readDates(previous))
    const archivedVehicleIds = vehicles.value
      .filter(vehicle => vehicle.archivedAt !== null)
      .map(vehicle => vehicle.id)
    const lastWeek = previous.flatMap(date =>
      (assignmentsByDate[date] ?? []).map(row => ({
        driverId: row.driverId,
        rosterDate: date,
        vehicleId: row.vehicleId,
      })),
    )
    const thisWeek = week.value.flatMap(date =>
      (assignmentsByDate[date] ?? []).map(row => ({
        driverId: row.driverId,
        rosterDate: date,
        vehicleId: row.vehicleId,
      })),
    )
    const plan = planRosterCopy({
      driverIds: activeDrivers.value.map(driver => driver.id),
      thisWeekDates: week.value,
      lastWeek,
      thisWeek,
      archivedVehicleIds,
    })
    let copied = 0
    const skipped: Array<{
      driverId: string
      rosterDate: string
      reason: RosterCopySkipReason | 'refused'
    }> = [...plan.skipped]
    // Cell by cell, not a batch. A later refusal does not undo an earlier write.
    for (const cell of plan.writes) {
      const ok = await write(cell.driverId, cell.rosterDate, cell.vehicleId)
      if (ok)
        copied += 1
      else
        skipped.push({ driverId: cell.driverId, rosterDate: cell.rosterDate, reason: 'refused' })
    }
    copyResult.value = { copied, skipped }
  }
  catch {
    loadError.value = true
  }
  finally {
    copying.value = false
  }
}

function shiftWeek(days: number) {
  copyResult.value = null
  weekStart.value = addCalendarDays(weekStart.value, days)
  void loadDates(weekDates(weekStart.value))
}

function shiftDay(days: number) {
  phoneDate.value = addCalendarDays(phoneDate.value, days)
  void loadDates([phoneDate.value])
}

function failureKey(error: unknown): RosterFailure {
  const code = rosterErrorCode(error)
  if (code === 'roster_vehicle_taken')
    return 'roster.vehicleTaken'
  if (code === 'roster_vehicle_archived')
    return 'roster.vehicleArchived'
  if (code === 'roster_driver_archived')
    return 'roster.driverArchived'
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

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <section>
    <div class="mb-4 hidden items-center gap-2 lg:flex">
      <UButton
        type="button"
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-left"
        :aria-label="t('roster.previousWeek')"
        :disabled="loading || copying"
        @click="shiftWeek(-7)"
      />
      <p class="min-w-36 text-center font-medium">
        {{ showingThisWeek ? t('roster.thisWeek') : weekRangeLabel }}
      </p>
      <UButton
        type="button"
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-right"
        :aria-label="t('roster.nextWeek')"
        :disabled="loading || copying"
        @click="shiftWeek(7)"
      />
      <UButton
        type="button"
        size="sm"
        :disabled="loading || copying || activeDrivers.length === 0"
        :loading="copying"
        @click="copyLastWeek"
      >
        {{ copying ? t('roster.copying') : t('roster.copyLastWeek') }}
      </UButton>
    </div>

    <div class="mb-4 flex items-center gap-2 lg:hidden">
      <UButton
        type="button"
        size="xl"
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-left"
        class="min-h-11"
        :aria-label="t('roster.previousDay')"
        :disabled="loading"
        @click="shiftDay(-1)"
      />
      <p class="min-w-36 flex-1 text-center text-lg font-medium">
        {{ showingToday ? t('roster.today') : dayHeading(phoneDate) }}
      </p>
      <UButton
        type="button"
        size="xl"
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-right"
        class="min-h-11"
        :aria-label="t('roster.nextDay')"
        :disabled="loading"
        @click="shiftDay(1)"
      />
    </div>

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
    <div
      v-if="copyResult"
      role="status"
      class="mb-4 text-sm"
    >
      <p>{{ t('roster.copyCopied', { count: copyResult.copied }) }}</p>
      <p v-if="copyResult.skipped.length > 0">
        {{ t('roster.copySkipped', { count: copyResult.skipped.length }) }}
      </p>
      <ul
        v-if="copyResult.skipped.length > 0"
        class="mt-2 list-disc ps-5"
      >
        <li
          v-for="row in copyResult.skipped"
          :key="`${row.driverId}:${row.rosterDate}:${row.reason}`"
        >
          {{ skipLine(row) }}
        </li>
      </ul>
    </div>
    <p
      v-if="loading"
      role="status"
    >
      {{ t('roster.loading') }}
    </p>
    <p v-else-if="boardDrivers.length === 0">
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

      <div class="hidden overflow-x-auto lg:block">
        <table class="w-full min-w-[56rem] border-separate border-spacing-2">
          <thead>
            <tr>
              <th class="text-start text-sm font-medium">
                {{ t('roster.driver') }}
              </th>
              <th
                v-for="date in week"
                :key="date"
                class="text-start text-sm font-medium"
              >
                {{ dayHeading(date) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="driver in boardDrivers"
              :key="driver.id"
            >
              <th class="align-top text-start font-medium">
                {{ driver.name }}
              </th>
              <td
                v-for="date in week"
                :key="date"
                class="align-top"
              >
                <p
                  v-if="driver.archivedAt !== null && assignedPlate(driver.id, date)"
                  class="font-mono text-sm"
                >
                  {{ assignedPlate(driver.id, date) }}
                </p>
                <USelect
                  v-else
                  :id="`roster-vehicle-${driver.id}-${date}`"
                  :model-value="choices[cellKey(driver.id, date)]"
                  :name="`vehicle-${driver.id}-${date}`"
                  :items="vehicleItems(date, driver.id)"
                  :placeholder="t('roster.chooseVehicle')"
                  value-key="value"
                  :aria-label="t('roster.vehicleForDay', { name: driver.name, date })"
                  :disabled="copying || cellState[cellKey(driver.id, date)] === 'saving'"
                  size="sm"
                  class="w-full min-w-36 font-mono"
                  @update:model-value="pick(driver.id, date, $event ?? undefined)"
                />
                <p
                  v-if="archivedPlate(driver.id, date)"
                  class="mt-1 text-xs text-muted"
                >
                  {{ t('roster.archivedStill', { plate: archivedPlate(driver.id, date) }) }}
                </p>
                <p
                  v-else-if="vehicleMissing(driver.id, date)"
                  class="mt-1 text-xs text-muted"
                >
                  {{ t('roster.missingVehicle') }}
                </p>
                <p
                  v-if="driverUnavailable(driver.id, date)"
                  class="mt-1 flex items-center gap-1 text-xs"
                >
                  <UIcon
                    name="i-lucide-calendar-off"
                    class="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  {{ t('roster.driverUnavailable') }}
                </p>
                <p
                  v-if="vehicleUnavailable(driver.id, date)"
                  class="mt-1 flex items-center gap-1 text-xs"
                >
                  <UIcon
                    name="i-lucide-calendar-off"
                    class="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  {{ t('roster.vehicleUnavailable') }}
                </p>
                <p
                  v-if="cellState[cellKey(driver.id, date)] === 'saving'"
                  class="mt-1 text-xs"
                >
                  {{ t('roster.saving') }}
                </p>
                <p
                  v-else-if="cellState[cellKey(driver.id, date)] === 'saved'"
                  role="status"
                  class="mt-1 text-xs"
                >
                  {{ t('roster.saved') }}
                </p>
                <p
                  v-else-if="cellErrorText(driver.id, date)"
                  role="alert"
                  class="mt-1 text-xs text-error"
                >
                  {{ cellErrorText(driver.id, date) }}
                </p>
                <UButton
                  v-if="assignmentFor(driver.id, date)"
                  type="button"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="mt-1"
                  :disabled="copying || cellState[cellKey(driver.id, date)] === 'saving'"
                  @click="clear(driver.id, date)"
                >
                  {{ t('roster.clearForDay', { name: driver.name, date }) }}
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-col gap-6 lg:hidden">
        <div
          v-for="driver in boardDrivers"
          :key="driver.id"
          class="flex flex-col gap-3"
        >
          <h2 class="text-lg font-semibold">
            {{ driver.name }}
          </h2>
          <p
            v-if="archivedPlate(driver.id, phoneDate)"
            class="text-sm text-muted"
          >
            {{ t('roster.archivedStill', { plate: archivedPlate(driver.id, phoneDate) }) }}
          </p>
          <p
            v-else-if="vehicleMissing(driver.id, phoneDate)"
            class="text-sm text-muted"
          >
            {{ t('roster.missingVehicle') }}
          </p>
          <p
            v-if="driverUnavailable(driver.id, phoneDate)"
            class="flex items-center gap-1 text-base"
          >
            <UIcon
              name="i-lucide-calendar-off"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            {{ t('roster.driverUnavailable') }}
          </p>
          <p
            v-if="vehicleUnavailable(driver.id, phoneDate)"
            class="flex items-center gap-1 text-base"
          >
            <UIcon
              name="i-lucide-calendar-off"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            {{ t('roster.vehicleUnavailable') }}
          </p>
          <p
            v-if="driver.archivedAt !== null && assignedPlate(driver.id, phoneDate)"
            class="font-mono text-base"
          >
            {{ assignedPlate(driver.id, phoneDate) }}
          </p>
          <UFormField
            v-else
            :label="t('roster.vehicleFor', { name: driver.name })"
            :name="`vehicle-${driver.id}`"
            size="xl"
          >
            <USelect
              :id="`roster-vehicle-${driver.id}`"
              :model-value="choices[cellKey(driver.id, phoneDate)]"
              :name="`vehicle-${driver.id}`"
              :items="vehicleItems(phoneDate, driver.id)"
              :placeholder="t('roster.chooseVehicle')"
              value-key="value"
              :disabled="cellState[cellKey(driver.id, phoneDate)] === 'saving'"
              size="xl"
              class="w-full min-h-11 font-mono"
              @update:model-value="pick(driver.id, phoneDate, $event ?? undefined)"
            />
          </UFormField>
          <p
            v-if="cellState[cellKey(driver.id, phoneDate)] === 'saving'"
          >
            {{ t('roster.saving') }}
          </p>
          <p
            v-else-if="cellState[cellKey(driver.id, phoneDate)] === 'saved'"
            role="status"
          >
            {{ t('roster.saved') }}
          </p>
          <p
            v-else-if="cellErrorText(driver.id, phoneDate)"
            role="alert"
          >
            {{ cellErrorText(driver.id, phoneDate) }}
          </p>
          <UButton
            v-if="assignmentFor(driver.id, phoneDate)"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            class="min-h-11"
            :disabled="cellState[cellKey(driver.id, phoneDate)] === 'saving'"
            @click="clear(driver.id, phoneDate)"
          >
            {{ t('roster.clearFor', { name: driver.name }) }}
          </UButton>
        </div>
      </div>
    </template>
  </section>
</template>
