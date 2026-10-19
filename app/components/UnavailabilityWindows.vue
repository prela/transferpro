<script setup lang="ts">
import type { CoveredRide, DisplayLocale, UnavailabilityWindowView } from '../../shared'
import {
  addCalendarDays,
  calendarDateInTimeZone,
  formatCalendarDate,
  formatInstant,
  instantFromWallClock,
  unavailabilityListSchema,
  unavailabilitySavedSchema,
  wallClockInTimeZone,
  wholeDaysOf,
  wholeDaysWindow,
} from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'

/**
 * Unavailability windows (Nedostupnost, ADR-0034) as a section of the Driver
 * or Vehicle edit panel. The office lists, adds, moves, and removes windows
 * for the one resource that panel opened. Times are entered and shown in the
 * Tenant time zone; the server stores instants. An archived resource is read
 * only here, as the rest of its panel is.
 */
const props = defineProps<{
  owner: 'driver' | 'vehicle'
  resourceId: string
  timeZone: string
  archived: boolean
  phone: boolean
}>()

const { t, locale } = useI18n()
const toast = useToast()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()
const wholeDaysId = useId()
const fromId = useId()
const toId = useId()

type WindowFailure
  = 'unavailability.loadFailed'
    | 'unavailability.dateInvalid'
    | 'unavailability.timeInvalid'
    | 'unavailability.orderInvalid'
    | 'unavailability.rejected'
    | 'unavailability.notFound'
    | 'unavailability.forbidden'
    | 'unavailability.signedOut'
    | 'unavailability.archived'
    | 'unavailability.saveFailed'
    | 'unavailability.removeFailed'

const windows = ref<UnavailabilityWindowView[]>([])
const loading = ref(false)
const loadErrorKey = ref<WindowFailure | null>(null)
const formErrorKey = ref<WindowFailure | null>(null)
const pending = ref(false)
const removingId = ref<string | null>(null)
/** The window the form moves. Null adds a new one. */
const editingWindowId = ref<string | null>(null)
/** The Rides the last save covers. They stay assigned and show the board warning. */
const coveredRides = ref<CoveredRide[]>([])

const today = calendarDateInTimeZone(props.timeZone, new Date())
const form = reactive({
  wholeDays: true,
  fromDay: today,
  toDay: today,
  startsAt: `${today}T08:00`,
  endsAt: `${today}T16:00`,
})

const displayLocale = computed<DisplayLocale>(() => locale.value === 'en' ? 'en' : 'hr')
const controlSize = computed(() => commandControlSize(props.phone))
const controlClass = computed(() => commandControlClass(props.phone))
const basePath = computed(() => `/api/${props.owner === 'driver' ? 'drivers' : 'vehicles'}/${props.resourceId}/unavailability`)
const submitLabel = computed(() => {
  if (editingWindowId.value)
    return pending.value ? t('unavailability.saving') : t('unavailability.save')
  return pending.value ? t('unavailability.adding') : t('unavailability.add')
})

/** Whole days read as dates, from the first to the last day. Any other window reads as two local times. */
function rangeLabel(entry: UnavailabilityWindowView): string {
  const days = wholeDaysOf(entry, props.timeZone)
  if (days) {
    const from = formatCalendarDate(days.fromDay, displayLocale.value)
    return days.fromDay === days.toDay ? from : `${from} – ${formatCalendarDate(days.toDay, displayLocale.value)}`
  }
  return `${formatInstant(new Date(entry.startsAt), props.timeZone, displayLocale.value)} – ${formatInstant(new Date(entry.endsAt), props.timeZone, displayLocale.value)}`
}

function pickupLabel(ride: CoveredRide): string {
  return formatInstant(new Date(ride.pickupAt), props.timeZone, displayLocale.value)
}

function failureKey(error: unknown, fallback: WindowFailure): WindowFailure {
  if (errorCode(error) === 'unavailability_archived')
    return 'unavailability.archived'
  switch (httpStatus(error)) {
    case 400: return 'unavailability.rejected'
    case 401: return 'unavailability.signedOut'
    case 403: return 'unavailability.forbidden'
    case 404: return 'unavailability.notFound'
    default: return fallback
  }
}

/** The form as two instants, or the copy that says what is missing. */
function readForm(): { startsAt: Date, endsAt: Date } | WindowFailure {
  if (form.wholeDays) {
    try {
      return wholeDaysWindow(form.fromDay, form.toDay, props.timeZone)
    }
    catch {
      return 'unavailability.dateInvalid'
    }
  }
  let startsAt: Date
  let endsAt: Date
  try {
    startsAt = instantFromWallClock(form.startsAt, props.timeZone)
    endsAt = instantFromWallClock(form.endsAt, props.timeZone)
  }
  catch {
    return 'unavailability.timeInvalid'
  }
  return startsAt < endsAt ? { startsAt, endsAt } : 'unavailability.orderInvalid'
}

function resetForm() {
  editingWindowId.value = null
  form.wholeDays = true
  form.fromDay = today
  form.toDay = today
  form.startsAt = `${today}T08:00`
  form.endsAt = `${today}T16:00`
  formErrorKey.value = null
}

/** Reopen a window in the form. Whole days come back with the shortcut on. */
function startChange(entry: UnavailabilityWindowView) {
  editingWindowId.value = entry.id
  formErrorKey.value = null
  coveredRides.value = []
  const days = wholeDaysOf(entry, props.timeZone)
  form.wholeDays = days !== null
  if (days) {
    form.fromDay = days.fromDay
    form.toDay = days.toDay
  }
  form.startsAt = wallClockInTimeZone(props.timeZone, new Date(entry.startsAt))
  form.endsAt = wallClockInTimeZone(props.timeZone, new Date(entry.endsAt))
}

async function load() {
  loading.value = true
  loadErrorKey.value = null
  try {
    windows.value = unavailabilityListSchema.parse(await $fetch(basePath.value)).windows
  }
  catch (error) {
    loadErrorKey.value = failureKey(error, 'unavailability.loadFailed')
  }
  finally {
    loading.value = false
  }
}

async function save() {
  formErrorKey.value = null
  coveredRides.value = []
  const read = readForm()
  if (typeof read === 'string') {
    formErrorKey.value = read
    return
  }
  pending.value = true
  const changing = editingWindowId.value
  const times = { startsAt: read.startsAt.toISOString(), endsAt: read.endsAt.toISOString() }
  try {
    const saved = unavailabilitySavedSchema.parse(changing
      ? await $fetch(`/api/unavailability/${changing}`, { method: 'PATCH', body: times })
      : await $fetch('/api/unavailability', {
          method: 'POST',
          body: { ...(props.owner === 'driver' ? { driverId: props.resourceId } : { vehicleId: props.resourceId }), ...times },
        }))
    notifyAuditChanged()
    toast.add({ title: changing ? t('unavailability.changed') : t('unavailability.added'), color: 'success' })
    resetForm()
    coveredRides.value = saved.coveredRides
    await load()
  }
  catch (error) {
    formErrorKey.value = failureKey(error, 'unavailability.saveFailed')
  }
  finally {
    pending.value = false
  }
}

async function remove(entry: UnavailabilityWindowView) {
  if (removingId.value)
    return
  removingId.value = entry.id
  formErrorKey.value = null
  coveredRides.value = []
  try {
    await $fetch(`/api/unavailability/${entry.id}/remove`, { method: 'POST' })
    notifyAuditChanged()
    toast.add({ title: t('unavailability.removedNotice'), color: 'success' })
    if (editingWindowId.value === entry.id)
      resetForm()
    await load()
  }
  catch (error) {
    formErrorKey.value = failureKey(error, 'unavailability.removeFailed')
  }
  finally {
    removingId.value = null
  }
}

/**
 * Turning the whole-day shortcut off keeps the days already typed as the start
 * of the first and the end of the last. Only the person's toggle does this:
 * a watch would also fire when Change reopens a timed window and replace its times.
 */
function chooseWholeDays(value: boolean | 'indeterminate') {
  form.wholeDays = value === true
  if (form.wholeDays)
    return
  form.startsAt = `${form.fromDay}T00:00`
  form.endsAt = `${addCalendarDays(form.toDay, 1)}T00:00`
}

watch(() => props.resourceId, () => {
  resetForm()
  coveredRides.value = []
  void load()
})

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('data' in error && typeof error.data === 'object' && error.data !== null && 'code' in error.data) {
    const code = error.data.code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section
    class="mt-6 border-t border-default pt-4"
    :aria-labelledby="titleId"
    data-testid="unavailability-windows"
  >
    <h3
      :id="titleId"
      class="mb-1 text-lg font-semibold"
    >
      {{ t('unavailability.title') }}
    </h3>
    <p class="mb-4 text-sm text-muted">
      {{ t('unavailability.intro') }}
    </p>
    <UAlert
      v-if="loadErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(loadErrorKey)"
    />
    <p
      v-else-if="loading"
      role="status"
      class="mb-4 text-sm"
    >
      {{ t('unavailability.loading') }}
    </p>
    <p
      v-else-if="windows.length === 0"
      class="mb-4 text-sm"
    >
      {{ t('unavailability.empty') }}
    </p>
    <ul
      v-else
      class="mb-4 flex flex-col gap-2"
      :aria-label="t('unavailability.listLabel')"
    >
      <li
        v-for="entry in windows"
        :key="entry.id"
        class="flex flex-wrap items-center gap-2 rounded-md border border-default p-2"
        :class="editingWindowId === entry.id ? 'bg-elevated' : ''"
      >
        <span class="min-w-0 flex-1">{{ rangeLabel(entry) }}</span>
        <template v-if="!archived">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            :size="controlSize"
            :class="controlClass"
            :disabled="pending || removingId !== null"
            :aria-label="t('unavailability.changeFor', { range: rangeLabel(entry) })"
            @click="startChange(entry)"
          >
            {{ t('unavailability.change') }}
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            :size="controlSize"
            :class="controlClass"
            :loading="removingId === entry.id"
            :disabled="pending || removingId !== null"
            :aria-label="t('unavailability.removeFor', { range: rangeLabel(entry) })"
            @click="remove(entry)"
          >
            {{ t('unavailability.remove') }}
          </UButton>
        </template>
      </li>
    </ul>

    <UAlert
      v-if="coveredRides.length > 0"
      color="neutral"
      variant="subtle"
      icon="i-lucide-calendar-off"
      role="status"
      class="mb-4"
      :title="t('unavailability.covered')"
    >
      <template #description>
        <ul class="list-disc ps-5">
          <li
            v-for="ride in coveredRides"
            :key="ride.rideId"
          >
            {{ pickupLabel(ride) }}
          </li>
        </ul>
      </template>
    </UAlert>

    <form
      v-if="!archived"
      class="flex flex-col gap-3"
      :class="commandInputClass"
      novalidate
      @submit.prevent="save"
    >
      <p
        v-if="editingWindowId"
        class="text-sm text-muted"
      >
        {{ t('unavailability.editing') }}
      </p>
      <UCheckbox
        :id="wholeDaysId"
        :model-value="form.wholeDays"
        name="unavailability-whole-days"
        :size="phone ? 'xl' : 'sm'"
        :label="t('unavailability.wholeDays')"
        :disabled="pending"
        @update:model-value="chooseWholeDays"
      />
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            :for="fromId"
            class="mb-1 block text-sm font-medium max-lg:text-base"
          >{{ form.wholeDays ? t('unavailability.fromDay') : t('unavailability.from') }}</label>
          <UInput
            v-if="form.wholeDays"
            :id="fromId"
            v-model="form.fromDay"
            name="unavailability-from-day"
            type="date"
            autocomplete="off"
            class="w-full"
            :size="controlSize"
            :disabled="pending"
          />
          <UInput
            v-else
            :id="fromId"
            v-model="form.startsAt"
            name="unavailability-from"
            type="datetime-local"
            autocomplete="off"
            class="w-full"
            :size="controlSize"
            :disabled="pending"
          />
        </div>
        <div>
          <label
            :for="toId"
            class="mb-1 block text-sm font-medium max-lg:text-base"
          >{{ form.wholeDays ? t('unavailability.toDay') : t('unavailability.to') }}</label>
          <UInput
            v-if="form.wholeDays"
            :id="toId"
            v-model="form.toDay"
            name="unavailability-to-day"
            type="date"
            autocomplete="off"
            class="w-full"
            :size="controlSize"
            :disabled="pending"
          />
          <UInput
            v-else
            :id="toId"
            v-model="form.endsAt"
            name="unavailability-to"
            type="datetime-local"
            autocomplete="off"
            class="w-full"
            :size="controlSize"
            :disabled="pending"
          />
        </div>
      </div>
      <UAlert
        v-if="formErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        :description="t(formErrorKey)"
      />
      <div class="flex flex-wrap gap-2">
        <UButton
          type="submit"
          :size="controlSize"
          :class="controlClass"
          :loading="pending"
          :disabled="pending || removingId !== null"
        >
          {{ submitLabel }}
        </UButton>
        <UButton
          v-if="editingWindowId"
          type="button"
          color="neutral"
          variant="outline"
          :size="controlSize"
          :class="controlClass"
          :disabled="pending"
          @click="resetForm"
        >
          {{ t('unavailability.cancelChange') }}
        </UButton>
      </div>
    </form>
  </section>
</template>
