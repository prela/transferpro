<script setup lang="ts">
import type { CapacityConfirmReason } from '../../shared'

/**
 * One confirmation for both capacity refusals (ADR-0034). The copy names
 * the refusal the server gave: an overlap, or an unavailability window.
 * `ride_unavailable` wins when both apply, and its copy says the same
 * confirmation also passes an overlap.
 */
const props = withDefaults(defineProps<{
  pending: boolean
  reason?: CapacityConfirmReason
}>(), { reason: 'overlap' })

const emit = defineEmits<{
  confirm: []
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const title = computed(() => props.reason === 'unavailable' ? t('ride.unavailableTitle') : t('ride.overlapTitle'))
const description = computed(() => props.reason === 'unavailable' ? t('ride.unavailableBody') : t('ride.overlapBody'))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
    :dismissible="!pending"
    :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
  >
    <template #footer>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="pending"
        @click="open = false"
      >
        {{ t('ride.cancel') }}
      </UButton>
      <UButton
        type="button"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="pending"
        :disabled="pending"
        @click="emit('confirm')"
      >
        {{ t('ride.overlapConfirm') }}
      </UButton>
    </template>
  </UModal>
</template>
