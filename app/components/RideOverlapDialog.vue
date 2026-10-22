<script setup lang="ts">
import type { CapacityDialogReason } from '../../shared'

/**
 * One dialog for the capacity refusals (ADR-0034). Overlap and
 * unavailability ask for one confirmation. `ride_unavailable` wins when
 * both apply, and its copy says the same confirmation also passes an
 * overlap. Popunjeno (`fullyBooked`) offers no confirmation: the command
 * is refused and confirming does not pass it.
 */
const props = withDefaults(defineProps<{
  pending: boolean
  reason?: CapacityDialogReason
}>(), { reason: 'overlap' })

const emit = defineEmits<{
  confirm: []
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const blocked = computed(() => props.reason === 'fullyBooked')
const title = computed(() => {
  if (props.reason === 'fullyBooked')
    return t('ride.fullyBookedTitle')
  return props.reason === 'unavailable' ? t('ride.unavailableTitle') : t('ride.overlapTitle')
})
const description = computed(() => {
  if (props.reason === 'fullyBooked')
    return t('ride.fullyBookedBody')
  return props.reason === 'unavailable' ? t('ride.unavailableBody') : t('ride.overlapBody')
})
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
        v-if="!blocked"
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
