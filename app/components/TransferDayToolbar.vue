<script setup lang="ts">
import type { SevenDayUnassignedPart, TransferDayFilter } from '../../shared'
import { addCalendarDays, isCalendarDate, TRANSFER_DAY_FILTERS } from '../../shared'

defineProps<{
  counts: Record<TransferDayFilter, number>
  clients: { id: string, name: string }[]
  drivers: { id: string, name: string }[]
  note: readonly SevenDayUnassignedPart[]
}>()

const emit = defineEmits<{
  add: []
  today: []
}>()

const day = defineModel<string>('day', { required: true })
const filter = defineModel<TransferDayFilter>('filter', { required: true })
const search = defineModel<string>('search', { required: true })
const clientId = defineModel<string | null>('clientId', { required: true })
const driverId = defineModel<string | null>('driverId', { required: true })

const { t } = useI18n()

/**
 * Fixed ids. Vue's useId follows component order, and this page's server
 * and client trees disagree, so a generated id was the hydration mismatch
 * on the day label (issue #252). Each label and its field share one id.
 */
const dayFieldId = 'transfer-day'
const searchFieldId = 'transfer-day-search'
const clientFieldId = 'transfer-day-client'
const driverFieldId = 'transfer-day-driver'

const controlClass = 'h-7 min-h-7 px-2 text-sm max-lg:h-11 max-lg:min-h-11 max-lg:text-base'

const partySearch = computed(() => ({
  autofocus: false as const,
}))

function shift(delta: number) {
  if (!isCalendarDate(day.value))
    return
  day.value = addCalendarDays(day.value, delta)
}
</script>

<template>
  <div class="mb-3 flex flex-wrap items-end gap-2">
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-chevron-left"
      :class="controlClass"
      :aria-label="t('transfers.previousDay')"
      @click="shift(-1)"
    />
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      :class="controlClass"
      @click="emit('today')"
    >
      {{ t('transfers.today') }}
    </UButton>
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-chevron-right"
      :class="controlClass"
      :aria-label="t('transfers.nextDay')"
      @click="shift(1)"
    />
    <div class="min-w-40">
      <label
        class="mb-1 block text-sm"
        :for="dayFieldId"
      >{{ t('transfers.day') }}</label>
      <UInput
        :id="dayFieldId"
        v-model="day"
        name="day"
        type="date"
        class="w-full text-base"
      />
    </div>
    <div
      v-if="note.length > 0"
      class="flex flex-wrap items-center gap-1 pb-1 text-sm"
      role="group"
      :aria-label="t('transfers.unassignedAhead')"
    >
      <span>{{ t('transfers.filters.unassigned') }}:</span>
      <template
        v-for="(part, index) in note"
        :key="part.date"
      >
        <span
          v-if="index > 0"
          aria-hidden="true"
        >,</span>
        <UButton
          type="button"
          color="neutral"
          variant="link"
          size="sm"
          class="h-7 min-h-7 px-1 text-sm max-lg:h-11 max-lg:min-h-11 max-lg:text-base"
          @click="day = part.date"
        >
          {{ part.name }} {{ part.count }}
        </UButton>
      </template>
    </div>
    <UButton
      type="button"
      size="sm"
      icon="i-lucide-plus"
      :class="controlClass"
      @click="emit('add')"
    >
      {{ t('transfers.add') }}
    </UButton>
  </div>

  <div class="mb-3 flex flex-wrap items-end gap-2">
    <div class="min-w-48 flex-1">
      <label
        class="mb-1 block text-sm"
        :for="searchFieldId"
      >{{ t('transfers.daySearch') }}</label>
      <UInput
        :id="searchFieldId"
        v-model="search"
        name="search"
        type="search"
        icon="i-lucide-search"
        :placeholder="t('transfers.daySearchPlaceholder')"
        class="w-full text-base"
      />
    </div>
    <div class="min-w-40">
      <label
        class="mb-1 block text-sm"
        :for="clientFieldId"
      >{{ t('transfers.columns.client') }}</label>
      <USelectMenu
        :id="clientFieldId"
        v-model="clientId"
        value-key="id"
        label-key="name"
        :items="clients"
        :placeholder="t('transfers.allClients')"
        :search-input="partySearch"
        clear
        class="w-full"
      />
    </div>
    <div class="min-w-40">
      <label
        class="mb-1 block text-sm"
        :for="driverFieldId"
      >{{ t('transfers.driver') }}</label>
      <USelectMenu
        :id="driverFieldId"
        v-model="driverId"
        value-key="id"
        label-key="name"
        :items="drivers"
        :placeholder="t('transfers.allDrivers')"
        :search-input="partySearch"
        clear
        class="w-full"
      />
    </div>
  </div>

  <div
    class="mb-3 flex flex-wrap gap-1"
    role="group"
    :aria-label="t('transfers.filtersLabel')"
  >
    <UButton
      v-for="item in TRANSFER_DAY_FILTERS"
      :key="item"
      type="button"
      color="neutral"
      :variant="filter === item ? 'solid' : 'outline'"
      size="sm"
      :class="controlClass"
      :aria-pressed="filter === item"
      @click="filter = item"
    >
      {{ t(`transfers.filters.${item}`) }} ({{ counts[item] }})
    </UButton>
  </div>
</template>
