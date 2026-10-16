<script setup lang="ts">
import type { TransferDayFilter } from '../../shared'
import { addCalendarDays, isCalendarDate } from '../../shared'

defineProps<{
  counts: Record<TransferDayFilter, number>
}>()

const emit = defineEmits<{
  add: []
  today: []
}>()

const day = defineModel<string>('day', { required: true })
const filter = defineModel<TransferDayFilter>('filter', { required: true })

const { t } = useI18n()

/**
 * Fixed id. Vue's useId follows component order, and this page's server
 * and client trees disagree, so a generated id was the hydration mismatch
 * on the day label (issue #252). The label and the field share this one.
 */
const dayFieldId = 'transfer-day'

const filters: TransferDayFilter[] = ['all', 'urgent', 'warnings', 'unassigned', 'waiting', 'inProgress', 'closed']

const controlClass = 'h-7 min-h-7 px-2 text-sm max-lg:h-11 max-lg:min-h-11 max-lg:text-base'

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

  <div
    class="mb-3 flex flex-wrap gap-1"
    role="group"
    :aria-label="t('transfers.filtersLabel')"
  >
    <UButton
      v-for="item in filters"
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
