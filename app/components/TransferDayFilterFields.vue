<script setup lang="ts">
import type { TransferDayRideStateFilter } from '../../shared'
import { TRANSFER_DAY_RIDE_STATE_FILTERS } from '../../shared'

defineProps<{
  clients: { id: string, name: string }[]
  drivers: { id: string, name: string }[]
  vehicles: { id: string, name: string }[]
  partners: { id: string, name: string }[]
}>()

const clientId = defineModel<string | null>('clientId', { required: true })
const driverId = defineModel<string | null>('driverId', { required: true })
const vehicleId = defineModel<string | null>('vehicleId', { required: true })
const partnerId = defineModel<string | null>('partnerId', { required: true })
const rideState = defineModel<TransferDayRideStateFilter | ''>('rideState', { required: true })
const needsAttention = defineModel<boolean>('needsAttention', { required: true })

const { t } = useI18n()

/**
 * Fixed ids. Vue's useId follows component order, and this page's server
 * and client trees disagree, so a generated id was the hydration mismatch
 * on the day label (issue #252). Each label and its field share one id.
 * The fields mount once, either inline or in the phone sheet.
 */
const clientFieldId = 'transfer-day-client'
const driverFieldId = 'transfer-day-driver'
const vehicleFieldId = 'transfer-day-vehicle'
const partnerFieldId = 'transfer-day-partner'
const rideStateFieldId = 'transfer-day-ride-state'

const partySearch = computed(() => ({
  autofocus: false as const,
}))

const rideStateItems = computed(() => TRANSFER_DAY_RIDE_STATE_FILTERS.map(value => ({
  value,
  label: value === 'assigned'
    ? t('transfers.rideStates.assigned')
    : value === 'handedOff'
      ? t('transfers.states.handed_off')
      : t(`transfers.filters.${value}`),
})))

/** An empty state is "all". The menu clears to null, which the URL omits. */
const rideStateChoice = computed({
  get: () => rideState.value === '' ? null : rideState.value,
  set: (value: TransferDayRideStateFilter | null) => {
    rideState.value = value ?? ''
  },
})
</script>

<template>
  <div class="flex flex-wrap items-end gap-2">
    <div class="min-w-40 flex-1">
      <label
        class="mb-1 block text-sm"
        :for="clientFieldId"
      >{{ t('transfers.columns.client') }}</label>
      <USelectMenu
        :id="clientFieldId"
        v-model="clientId"
        value-key="id"
        label-key="name"
        :items="clients"
        :placeholder="t('transfers.allClients')"
        :search-input="partySearch"
        clear
        size="sm"
        class="w-full text-base"
        :ui="{ base: 'max-lg:h-11' }"
      />
    </div>
    <div class="min-w-40 flex-1">
      <label
        class="mb-1 block text-sm"
        :for="driverFieldId"
      >{{ t('transfers.driver') }}</label>
      <USelectMenu
        :id="driverFieldId"
        v-model="driverId"
        value-key="id"
        label-key="name"
        :items="drivers"
        :placeholder="t('transfers.allDrivers')"
        :search-input="partySearch"
        clear
        size="sm"
        class="w-full text-base"
        :ui="{ base: 'max-lg:h-11' }"
      />
    </div>
    <div class="min-w-40 flex-1">
      <label
        class="mb-1 block text-sm"
        :for="vehicleFieldId"
      >{{ t('transfers.vehicle') }}</label>
      <USelectMenu
        :id="vehicleFieldId"
        v-model="vehicleId"
        value-key="id"
        label-key="name"
        :items="vehicles"
        :placeholder="t('transfers.allVehicles')"
        :search-input="partySearch"
        clear
        size="sm"
        class="w-full text-base"
        :ui="{ base: 'max-lg:h-11' }"
      />
    </div>
    <div class="min-w-40 flex-1">
      <label
        class="mb-1 block text-sm"
        :for="partnerFieldId"
      >{{ t('transfers.partner') }}</label>
      <USelectMenu
        :id="partnerFieldId"
        v-model="partnerId"
        value-key="id"
        label-key="name"
        :items="partners"
        :placeholder="t('transfers.allPartners')"
        :search-input="partySearch"
        clear
        size="sm"
        class="w-full text-base"
        :ui="{ base: 'max-lg:h-11' }"
      />
    </div>
    <div class="min-w-40 flex-1">
      <label
        class="mb-1 block text-sm"
        :for="rideStateFieldId"
      >{{ t('transfers.rideState') }}</label>
      <USelectMenu
        :id="rideStateFieldId"
        v-model="rideStateChoice"
        value-key="value"
        label-key="label"
        :items="rideStateItems"
        :placeholder="t('transfers.allRideStates')"
        :search-input="false"
        clear
        size="sm"
        class="w-full text-base"
        :ui="{ base: 'max-lg:h-11' }"
      />
    </div>
    <UCheckbox
      v-model="needsAttention"
      :label="t('transfers.needsAttention')"
      class="mb-1 max-lg:min-h-11"
      :ui="{ label: 'text-sm max-lg:text-base' }"
    />
  </div>
</template>
