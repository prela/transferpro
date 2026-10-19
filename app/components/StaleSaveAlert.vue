<script setup lang="ts">
import type { DisplayLocale } from '../../shared'
import { formatInstant, staleSaveNotice } from '../../shared'
import { commandControlClass, commandControlSize } from '../ride-detail'

const props = defineProps<{
  /** Null when the member has left, or when no author was recorded. */
  changedByName: string | null
  changedAt: string | null
  timeZone: string
  locale: DisplayLocale
  /** Phone uses the large target. Desktop uses the office size. */
  phone?: boolean
  pending?: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)

const message = computed(() => {
  const notice = staleSaveNotice(props.changedByName, props.changedAt)
  if (notice.kind === 'unknown')
    return t('ride.staleUnknown')
  const time = formatInstant(new Date(notice.at), props.timeZone, props.locale)
  const name = notice.kind === 'former' ? t('audit.formerMember') : notice.name
  return t('ride.staleBy', { name, time })
})

onMounted(() => {
  // The refusal is the new thing on the form. Focus lands on the message.
  root.value?.focus()
})
</script>

<template>
  <div
    ref="root"
    tabindex="-1"
    role="alert"
    class="mb-4"
  >
    <UAlert
      color="error"
      variant="subtle"
      :description="message"
      :ui="{ description: '!text-default !opacity-100' }"
    >
      <template #actions>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="commandControlSize(phone === true)"
          :class="commandControlClass(phone === true)"
          :disabled="pending"
          :loading="pending"
          @click="emit('refresh')"
        >
          {{ t('ride.staleRefresh') }}
        </UButton>
      </template>
    </UAlert>
  </div>
</template>
