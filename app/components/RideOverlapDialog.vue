<script setup lang="ts">
defineProps<{
  pending: boolean
}>()

const emit = defineEmits<{
  confirm: []
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('ride.overlapTitle')"
    :description="t('ride.overlapBody')"
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
