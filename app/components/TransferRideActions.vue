<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TransferDayRide } from '../../shared'
import { acceptByPhoneButtonId, assignButtonId, markDoneButtonId } from '../transfer-ride-buttons'
import { canFinish, canRecordAcceptanceByPhone } from '../transfer-ride-guards'

defineProps<{
  ride: TransferDayRide
  menuItems: DropdownMenuItem[][]
  controlClass: string
}>()

const emit = defineEmits<{
  assign: [ride: TransferDayRide]
  acceptByPhone: [ride: TransferDayRide]
  markDone: [ride: TransferDayRide]
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-nowrap items-center gap-1">
    <UButton
      v-if="ride.state === 'unassigned'"
      :id="assignButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      :class="controlClass"
      :aria-label="t('ride.assignFor', { guest: ride.guestName })"
      @click="emit('assign', ride)"
    >
      {{ t('ride.assign') }}
    </UButton>
    <UButton
      v-else-if="canRecordAcceptanceByPhone(ride)"
      :id="acceptByPhoneButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      :class="controlClass"
      :aria-label="t('transfers.rowAcceptFor', { guest: ride.guestName })"
      @click="emit('acceptByPhone', ride)"
    >
      {{ t('transfers.rowAccept') }}
    </UButton>
    <UButton
      v-else-if="canFinish(ride)"
      :id="markDoneButtonId(ride.rideId)"
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      :class="controlClass"
      :aria-label="t('transfers.rowDoneFor', { guest: ride.guestName })"
      @click="emit('markDone', ride)"
    >
      {{ t('transfers.rowDone') }}
    </UButton>
    <UDropdownMenu
      v-if="menuItems.length > 0"
      :items="menuItems"
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-ellipsis-vertical"
        :class="controlClass"
        :aria-label="t('transfers.actionsFor', { guest: ride.guestName })"
      />
    </UDropdownMenu>
  </div>
</template>
