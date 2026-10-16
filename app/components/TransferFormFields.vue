<script setup lang="ts">
import { transferFormKey } from '../composables/transfer-form'
import { commandInputClass } from '../ride-detail'

const props = withDefaults(defineProps<{
  /** Office controls are small. The phone and the add slideover stay large. */
  controlSize?: 'sm' | 'xl'
}>(), {
  controlSize: 'xl',
})
const api = inject(transferFormKey)
if (!api)
  throw new Error('Transfer form fields are mounted outside the form.')

const controlClass = computed(() => props.controlSize === 'xl' ? 'min-h-12' : 'h-7 min-h-7')

const {
  clientId,
  pickupWall,
  startLocationId,
  endLocationId,
  passengers,
  guest,
  tabla,
  flight,
  price,
  payment,
  airportMark,
  luggage,
  childSeats,
  note,
  placeTarget,
  placeName,
  placeKind,
  placeAddress,
  pending,
  placePending,
  formMode,
  formErrorKey,
  guestErrorKey,
  tablaErrorKey,
  flightErrorKey,
  noteErrorKey,
  priceErrorKey,
  passengerErrorKey,
  luggageErrorKey,
  seatErrorKey,
  pickupErrorKey,
  endErrorKey,
  placeNameErrorKey,
  placeKindErrorKey,
  clientItems,
  locationItems,
  paymentItems,
  kindItems,
  formOpen,
  openPlace,
  addPlace,
  saveCorrection,
  record,
} = api
const { t } = useI18n()
</script>

<template>
  <p
    v-if="pending || placePending"
    role="status"
    class="sr-only"
  >
    {{
      placePending
        ? t('transfers.addPlace')
        : formMode === 'edit'
          ? t('transfers.savingCorrection')
          : t('transfers.submitting')
    }}
  </p>
  <UAlert
    v-if="formErrorKey"
    color="error"
    variant="subtle"
    role="alert"
    class="mb-4"
    :description="t(formErrorKey)"
  />

  <form
    v-if="placeTarget"
    class="mb-6"
    :class="commandInputClass"
    @submit.prevent="addPlace"
  >
    <h3 class="mb-4 text-lg font-semibold">
      {{ placeTarget === 'start' ? t('transfers.placeForStart') : t('transfers.placeForEnd') }}
    </h3>
    <UFormField
      :label="t('locations.name')"
      name="place-name"
      class="mb-4"
      :size="controlSize"
      :error="placeNameErrorKey ? t(placeNameErrorKey) : false"
    >
      <UInput
        id="place-name"
        v-model="placeName"
        name="place-name"
        type="text"
        autocomplete="off"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('locations.kind')"
      name="place-kind"
      class="mb-4"
      :size="controlSize"
      :error="placeKindErrorKey ? t(placeKindErrorKey) : false"
    >
      <USelect
        id="place-kind"
        v-model="placeKind"
        name="place-kind"
        :items="kindItems"
        :placeholder="t('locations.chooseKind')"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('locations.address')"
      name="place-address"
      class="mb-4"
      :size="controlSize"
    >
      <UInput
        id="place-address"
        v-model="placeAddress"
        name="place-address"
        type="text"
        autocomplete="off"
        class="w-full"
      />
    </UFormField>
    <UButton
      type="submit"
      :size="controlSize"
      :class="controlClass"
      :loading="placePending"
    >
      {{ t('transfers.addPlace') }}
    </UButton>
  </form>

  <form
    id="transfer-form"
    :class="commandInputClass"
    @submit.prevent="formMode === 'edit' ? saveCorrection() : record()"
  >
    <UFormField
      :label="t('transfers.client')"
      name="client"
      class="mb-4"
      :size="controlSize"
    >
      <USelect
        id="transfer-client"
        v-model="clientId"
        name="client"
        :items="clientItems"
        :placeholder="t('transfers.chooseClient')"
        class="w-full"
      />
    </UFormField>
    <UFormField
      :label="t('transfers.pickupAt')"
      name="pickup"
      class="mb-4"
      :size="controlSize"
      :error="pickupErrorKey ? t(pickupErrorKey) : false"
    >
      <UInput
        id="transfer-pickup"
        v-model="pickupWall"
        name="pickup"
        type="datetime-local"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.start')"
      name="start"
      class="mb-4"
      :size="controlSize"
    >
      <USelect
        id="transfer-start"
        v-model="startLocationId"
        name="start"
        :items="locationItems"
        :placeholder="t('transfers.chooseLocation')"
        class="w-full"
      />
    </UFormField>
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :size="controlSize"
      class="mb-4"
      :class="controlClass"
      @click="openPlace('start')"
    >
      {{ t('transfers.placeForStart') }}
    </UButton>
    <UFormField
      :label="t('transfers.end')"
      name="end"
      class="mb-4"
      :size="controlSize"
      :error="endErrorKey ? t(endErrorKey) : false"
    >
      <USelect
        id="transfer-end"
        v-model="endLocationId"
        name="end"
        :items="locationItems"
        :placeholder="t('transfers.chooseLocation')"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :size="controlSize"
      class="mb-4"
      :class="controlClass"
      @click="openPlace('end')"
    >
      {{ t('transfers.placeForEnd') }}
    </UButton>
    <UFormField
      :label="t('transfers.passengers')"
      name="passengers"
      class="mb-4"
      :size="controlSize"
      :error="passengerErrorKey ? t(passengerErrorKey) : false"
    >
      <UInput
        id="transfer-passengers"
        v-model="passengers"
        name="passengers"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.guest')"
      name="guest"
      class="mb-4"
      :size="controlSize"
      :error="guestErrorKey ? t(guestErrorKey) : false"
    >
      <UInput
        id="transfer-guest"
        v-model="guest"
        name="guest"
        type="text"
        autocomplete="off"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.tabla')"
      name="tabla"
      class="mb-4"
      :size="controlSize"
      :error="tablaErrorKey ? t(tablaErrorKey) : false"
    >
      <UInput
        id="transfer-tabla"
        v-model="tabla"
        name="tabla"
        type="text"
        autocomplete="off"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.flight')"
      name="flight"
      class="mb-4"
      :size="controlSize"
      :error="flightErrorKey ? t(flightErrorKey) : false"
    >
      <UInput
        id="transfer-flight"
        v-model="flight"
        name="flight"
        type="text"
        autocomplete="off"
        class="w-full font-mono"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.price')"
      name="price"
      class="mb-4"
      :size="controlSize"
      :error="priceErrorKey ? t(priceErrorKey) : false"
    >
      <UInput
        id="transfer-price"
        v-model="price"
        name="price"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        class="w-full tabular-nums"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.payment')"
      name="payment"
      class="mb-4"
      :size="controlSize"
    >
      <USelect
        id="transfer-payment"
        v-model="payment"
        name="payment"
        :items="paymentItems"
        :placeholder="t('transfers.choosePayment')"
        class="w-full"
      />
    </UFormField>
    <UCheckbox
      id="transfer-airport"
      v-model="airportMark"
      name="airport"
      :size="controlSize"
      class="mb-4"
      :label="t('transfers.airport')"
    />
    <UFormField
      :label="t('transfers.luggage')"
      name="luggage"
      class="mb-4"
      :size="controlSize"
      :error="luggageErrorKey ? t(luggageErrorKey) : false"
    >
      <UInput
        id="transfer-luggage"
        v-model="luggage"
        name="luggage"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.childSeats')"
      name="child-seats"
      class="mb-4"
      :size="controlSize"
      :error="seatErrorKey ? t(seatErrorKey) : false"
    >
      <UInput
        id="transfer-seats"
        v-model="childSeats"
        name="child-seats"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('transfers.note')"
      name="note"
      class="mb-4"
      :size="controlSize"
      :error="noteErrorKey ? t(noteErrorKey) : false"
    >
      <UTextarea
        id="transfer-note"
        v-model="note"
        name="note"
        :rows="3"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
  </form>
  <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :size="controlSize"
      class="w-full justify-center sm:w-auto"
      :class="controlClass"
      :disabled="pending"
      @click="formOpen = false"
    >
      {{ t('transfers.cancelCorrect') }}
    </UButton>
    <UButton
      type="submit"
      form="transfer-form"
      :size="controlSize"
      class="w-full justify-center sm:w-auto"
      :class="controlClass"
      :loading="pending"
    >
      {{
        formMode === 'edit'
          ? (pending ? t('transfers.savingCorrection') : t('transfers.saveCorrection'))
          : (pending ? t('transfers.submitting') : t('transfers.submit'))
      }}
    </UButton>
  </div>
</template>
