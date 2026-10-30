<script setup lang="ts">
import { passengersExceedSeatCount } from '../../shared'

const props = defineProps<{
  passengerCount: number
  /** Null is an existing Vehicle with no count yet. That shows nothing. */
  seatCount: number | null | undefined
}>()

const { t } = useI18n()

const show = computed(() => passengersExceedSeatCount(props.passengerCount, props.seatCount))
</script>

<template>
  <!--
    Text only. The assignment, the vehicle change, and the reassignment
    still save. This is not a capacity refusal (ADR-0059).
  -->
  <p
    v-if="show"
    class="mb-4 text-sm"
    role="status"
  >
    {{ t('transfers.attentionDetail.tooManyPassengers') }}
  </p>
</template>
