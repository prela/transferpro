<script setup lang="ts">
import type { TenantChoice } from '../../shared'

defineProps<{
  choices: readonly TenantChoice[]
  pending: boolean
}>()

const emit = defineEmits<{
  choose: [tenantId: string]
}>()

const { t } = useI18n()

/** The button name is the company and the role in that company. */
function label(choice: TenantChoice): string {
  return `${choice.tenantName}, ${t(`invite.roles.${choice.role}`)}`
}
</script>

<template>
  <!--
    Shown only when the session has not chosen a Tenant (ADR-0056).
    The list is the company and the role there. It is not that company's data.
  -->
  <h2 class="text-lg font-semibold text-highlighted">
    {{ t('tenantGate.title') }}
  </h2>
  <p class="mt-1 mb-4 text-sm text-muted">
    {{ t('tenantGate.lead') }}
  </p>
  <ul class="flex flex-col gap-2">
    <li
      v-for="choice in choices"
      :key="choice.tenantId"
    >
      <UButton
        type="button"
        size="xl"
        block
        color="neutral"
        variant="outline"
        class="min-h-11 justify-between"
        :disabled="pending"
        :aria-label="label(choice)"
        @click="emit('choose', choice.tenantId)"
      >
        <span class="flex w-full items-center justify-between gap-3">
          <span>{{ choice.tenantName }}</span>
          <span>{{ t(`invite.roles.${choice.role}`) }}</span>
        </span>
      </UButton>
    </li>
  </ul>
</template>
