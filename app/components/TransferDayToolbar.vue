<script setup lang="ts">
defineProps<{
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  add: []
}>()

const day = defineModel<string>('day', { required: true })

const { t } = useI18n()
</script>

<template>
  <UFormField
    :label="t('transfers.day')"
    name="day"
    class="mb-4"
    size="xl"
  >
    <UInput
      id="transfer-day"
      v-model="day"
      name="day"
      type="date"
      class="w-full"
    />
  </UFormField>

  <UButton
    type="button"
    color="neutral"
    variant="outline"
    size="xl"
    class="mb-4 mr-2"
    :disabled="loading"
    @click="emit('refresh')"
  >
    {{ t('transfers.refresh') }}
  </UButton>

  <UButton
    type="button"
    size="xl"
    icon="i-lucide-plus"
    class="mb-4"
    @click="emit('add')"
  >
    {{ t('transfers.add') }}
  </UButton>
</template>
