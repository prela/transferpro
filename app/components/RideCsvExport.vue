<script setup lang="ts">
import { addCalendarDays, calendarDateInTimeZone } from '../../shared'

const props = defineProps<{
  timeZone: string
}>()

const { t } = useI18n()

const open = ref(false)
const pending = ref(false)
const from = ref('')
const to = ref('')
const errorKey = ref<'transfers.exportRange' | 'transfers.exportFailed' | null>(null)

/**
 * Fixed ids. A generated id disagreed between the server and the client
 * on the day field (issue #252). The label and the input share one id.
 */
const fromId = 'ride-export-from'
const toId = 'ride-export-to'

/**
 * The current calendar month in the Tenant zone. The first and last dates
 * are calendar dates, the same dates the export counts.
 */
function currentMonth(timeZone: string): { from: string, to: string } {
  const today = calendarDateInTimeZone(timeZone, new Date())
  const year = today.slice(0, 4)
  const month = today.slice(5, 7)
  const start = `${year}-${month}-01`
  const next = month === '12'
    ? `${Number(year) + 1}-01-01`
    : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`
  return { from: start, to: addCalendarDays(next, -1) }
}

function openExport() {
  const range = currentMonth(props.timeZone)
  from.value = range.from
  to.value = range.to
  errorKey.value = null
  open.value = true
}

function filenameFrom(header: string | null): string {
  const match = /^attachment; filename="(rides-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv)"$/.exec(header ?? '')
  return match?.[1] ?? `rides-${from.value}-${to.value}.csv`
}

async function download() {
  errorKey.value = null
  pending.value = true
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value })
    const response = await fetch(`/api/transfers/export?${params}`)
    if (!response.ok) {
      errorKey.value = response.status === 400 ? 'transfers.exportRange' : 'transfers.exportFailed'
      return
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filenameFrom(response.headers.get('content-disposition'))
    link.click()
    URL.revokeObjectURL(url)
    open.value = false
  }
  catch {
    errorKey.value = 'transfers.exportFailed'
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <UButton
    type="button"
    color="neutral"
    variant="outline"
    size="sm"
    icon="i-lucide-download"
    class="h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base"
    @click="openExport"
  >
    {{ t('transfers.exportCsv') }}
  </UButton>
  <UModal
    v-model:open="open"
    :title="t('transfers.exportTitle')"
    :dismissible="!pending"
  >
    <template #body>
      <UAlert
        v-if="errorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(errorKey)"
      />
      <form
        class="flex flex-col gap-4"
        @submit.prevent="download"
      >
        <div>
          <label
            class="mb-1 block text-sm"
            :for="fromId"
          >{{ t('transfers.exportFrom') }}</label>
          <UInput
            :id="fromId"
            v-model="from"
            name="from"
            type="date"
            required
            class="w-full text-base"
            :disabled="pending"
          />
        </div>
        <div>
          <label
            class="mb-1 block text-sm"
            :for="toId"
          >{{ t('transfers.exportTo') }}</label>
          <UInput
            :id="toId"
            v-model="to"
            name="to"
            type="date"
            required
            class="w-full text-base"
            :disabled="pending"
          />
        </div>
        <UButton
          type="submit"
          :disabled="pending"
        >
          {{ pending ? t('transfers.exportDownloading') : t('transfers.exportDownload') }}
        </UButton>
      </form>
    </template>
  </UModal>
</template>
