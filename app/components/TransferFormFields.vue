<script setup lang="ts">
import type { AddressSuggestion, ClientOfficeBrief } from '../../shared'
import { z } from 'zod'
import { LOCATION_SUGGEST_MIN_LENGTH, suggestAddressesResponseSchema, transferMoreHasValue } from '../../shared'
import { transferFormKey } from '../composables/transfer-form'
import { commandInputClass } from '../ride-detail'

const props = withDefaults(defineProps<{
  /** Office controls are small. The phone stays large. */
  controlSize?: 'sm' | 'xl'
  /** The day read. The note under the Client select comes from here, and is not saved. */
  clientBriefs: ClientOfficeBrief[]
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
  clientReference,
  flight,
  price,
  payment,
  extraVehicle,
  asksGroupCount,
  groupPassengers,
  offerApplyToExtraVehicles,
  applyToExtraVehicles,
  airportMark,
  luggage,
  childSeats,
  note,
  placeTarget,
  placeName,
  placeKind,
  placeAddress,
  heldPlace,
  clientTarget,
  clientName,
  clientKind,
  pending,
  placePending,
  formMode,
  formErrorKey,
  guestErrorKey,
  tablaErrorKey,
  clientReferenceErrorKey,
  flightErrorKey,
  noteErrorKey,
  priceErrorKey,
  passengerErrorKey,
  luggageErrorKey,
  seatErrorKey,
  groupErrorKey,
  pickupErrorKey,
  endErrorKey,
  clientErrorKey,
  startErrorKey,
  paymentErrorKey,
  placeNameErrorKey,
  placeKindErrorKey,
  clientNameErrorKey,
  clientKindErrorKey,
  validationNonce,
  moreOpenNonce,
  restored,
  alreadySaved,
  confirmAlreadySaved,
  clientItems,
  locationItems,
  paymentItems,
  kindItems,
  clientKindItems,
  formOpen,
  openPlace,
  addPlace,
  openClient,
  addClient,
  discardDraft,
  saveCorrection,
  record,
} = api
const { t } = useI18n()

/**
 * The standing note of the Client chosen in this form. It is display only:
 * the save body is the Transfer, and this text is not one of its fields.
 * Changing the Client changes the note. No note, and no chosen Client, show nothing.
 */
const clientOfficeNote = computed(() => {
  const id = clientId.value
  if (!id)
    return null
  return props.clientBriefs.find(brief => brief.clientId === id)?.note ?? null
})

const clientSearch = ref('')
const startSearch = ref('')
const endSearch = ref('')
const summaryEl = ref<HTMLElement | null>(null)
const alreadySavedEl = ref<HTMLElement | null>(null)
const moreOpen = ref(false)

const summaryLines = computed(() => {
  const keys = [
    formErrorKey.value,
    clientErrorKey.value,
    pickupErrorKey.value,
    startErrorKey.value,
    endErrorKey.value,
    guestErrorKey.value,
    passengerErrorKey.value,
    priceErrorKey.value,
    paymentErrorKey.value,
    flightErrorKey.value,
    tablaErrorKey.value,
    clientReferenceErrorKey.value,
    luggageErrorKey.value,
    seatErrorKey.value,
    groupErrorKey.value,
    noteErrorKey.value,
  ]
  return keys.filter(key => key !== null).map(key => t(key))
})

function syncMore() {
  // Luggage and child seats live under Više. An extra vehicle starts them
  // empty, so Više stays open until the office can fill them.
  moreOpen.value = extraVehicle.value || transferMoreHasValue({
    flight: flight.value,
    airportMark: airportMark.value,
    tabla: tabla.value,
    luggage: luggage.value,
    childSeats: childSeats.value,
    note: note.value,
  })
}

watch(validationNonce, async () => {
  await nextTick()
  summaryEl.value?.focus()
})

// The notice is the new thing on the form. Focus lands on it, not on a disabled field.
watch(alreadySaved, async (showing) => {
  if (!showing)
    return
  await nextTick()
  alreadySavedEl.value?.focus()
})

watch(formMode, () => {
  syncMore()
})

// A prefill lands while the mode is already `add`, so the mode watch does
// not run. Open Više when the copied booking has a value there.
watch(moreOpenNonce, () => {
  syncMore()
})

watch(extraVehicle, () => {
  syncMore()
})

onMounted(() => {
  syncMore()
})

function namedAdd(search: string, fallback: string) {
  const name = search.trim()
  return name === '' ? fallback : t('transfers.addNamed', { name })
}

/** A created row is not an id. The small form selects the record after it is saved. */
function rejectFreeText(value: string | undefined) {
  return value !== undefined && !z.uuid().safeParse(value).success
}

function onCreateClient(item: string) {
  openClient(item)
  void nextTick(() => {
    if (rejectFreeText(clientId.value))
      clientId.value = undefined
  })
}

function onCreateStart(item: string) {
  openPlace('start', item)
  void nextTick(() => {
    if (rejectFreeText(startLocationId.value))
      startLocationId.value = undefined
  })
}

function onCreateEnd(item: string) {
  openPlace('end', item)
  void nextTick(() => {
    if (rejectFreeText(endLocationId.value))
      endLocationId.value = undefined
  })
}

// Address suggestions for the Location quick-add. The existing create write
// still requires a kind, so the small form asks for one.
const SUGGEST_PAUSE_MS = 300
const suggestions = ref<AddressSuggestion[]>([])
const attribution = ref<string | null>(null)
const suggestionsUnavailable = ref(false)
let suggestTimer = 0
let suggestGeneration = 0
let sessionToken: string | null = null
const suggestionItems = computed(() => suggestions.value.map(suggestion => suggestion.text))

function onAddressInput(value: string | number | null | undefined) {
  const next = value == null ? '' : String(value)
  const match = suggestions.value.find(suggestion => suggestion.text === next)
  if (match) {
    heldPlace.value = { provider: match.provider, placeRef: match.placeRef }
    sessionToken = null
    suggestions.value = []
    return
  }
  heldPlace.value = null
  window.clearTimeout(suggestTimer)
  suggestTimer = window.setTimeout(() => {
    void lookupSuggestions()
  }, SUGGEST_PAUSE_MS)
}

async function lookupSuggestions() {
  const text = placeAddress.value.trim()
  if (text.length < LOCATION_SUGGEST_MIN_LENGTH) {
    suggestions.value = []
    attribution.value = null
    return
  }
  if (sessionToken === null)
    sessionToken = crypto.randomUUID()
  const generation = ++suggestGeneration
  try {
    const result = suggestAddressesResponseSchema.parse(await $fetch('/api/locations/suggestions', {
      method: 'POST',
      body: { text, sessionToken },
    }))
    if (generation !== suggestGeneration)
      return
    if (!result.available) {
      suggestions.value = []
      attribution.value = null
      suggestionsUnavailable.value = true
      return
    }
    suggestionsUnavailable.value = false
    suggestions.value = [...result.suggestions]
    attribution.value = result.suggestions.length > 0 ? result.attribution : null
  }
  catch {
    if (generation !== suggestGeneration)
      return
    suggestions.value = []
    attribution.value = null
    suggestionsUnavailable.value = true
  }
}

onUnmounted(() => {
  window.clearTimeout(suggestTimer)
})
</script>

<template>
  <p
    v-if="pending || placePending"
    role="status"
    class="sr-only"
  >
    {{
      placePending
        ? (clientTarget ? t('transfers.quickClientSubmitting') : t('transfers.addPlace'))
        : formMode === 'edit'
          ? t('transfers.savingCorrection')
          : t('transfers.submitting')
    }}
  </p>

  <div
    v-if="alreadySaved"
    ref="alreadySavedEl"
    tabindex="-1"
    role="status"
    class="mb-4"
  >
    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      :title="t('transfers.alreadySavedTitle')"
      :description="t('transfers.alreadySavedBody')"
      :ui="{ title: '!text-default', description: '!text-default !opacity-100' }"
    >
      <template #actions>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="controlSize"
          :class="controlClass"
          :disabled="pending"
          :loading="pending"
          @click="confirmAlreadySaved"
        >
          {{ t('transfers.alreadySavedConfirm') }}
        </UButton>
      </template>
    </UAlert>
  </div>

  <div
    v-if="restored && !alreadySaved"
    class="mb-4 flex flex-wrap items-center justify-between gap-2"
  >
    <p>{{ t('transfers.draftRestored') }}</p>
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :size="controlSize"
      :class="controlClass"
      @click="discardDraft"
    >
      {{ t('transfers.discardDraft') }}
    </UButton>
  </div>

  <form
    v-if="clientTarget && !alreadySaved"
    class="mb-6"
    :class="commandInputClass"
    @submit.prevent="addClient"
  >
    <h3 class="mb-4 text-lg font-semibold">
      {{ t('transfers.quickClient') }}
    </h3>
    <UFormField
      :label="t('clients.name')"
      name="client-name"
      class="mb-4"
      :size="controlSize"
      :error="clientNameErrorKey ? t(clientNameErrorKey) : false"
    >
      <UInput
        id="quick-client-name"
        v-model="clientName"
        name="client-name"
        type="text"
        autocomplete="off"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UFormField
      :label="t('clients.kind')"
      name="client-kind"
      class="mb-4"
      :size="controlSize"
      :error="clientKindErrorKey ? t(clientKindErrorKey) : false"
    >
      <USelect
        id="quick-client-kind"
        v-model="clientKind"
        name="client-kind"
        :items="clientKindItems"
        :placeholder="t('clients.chooseKind')"
        class="w-full"
      />
      <template #error="{ error }">
        <span role="alert">{{ error }}</span>
      </template>
    </UFormField>
    <UButton
      type="submit"
      :size="controlSize"
      :class="controlClass"
      :loading="placePending"
    >
      {{ t('transfers.quickClientSubmit') }}
    </UButton>
  </form>

  <form
    v-if="placeTarget && !alreadySaved"
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
      <UInputMenu
        id="place-address"
        v-model="placeAddress"
        mode="autocomplete"
        name="place-address"
        autocomplete="off"
        class="w-full"
        :items="suggestionItems"
        :ignore-filter="true"
        :trailing-icon="false"
        :content="{ hideWhenEmpty: true }"
        @update:model-value="onAddressInput"
      >
        <template #content-bottom>
          <p
            v-if="attribution"
            class="px-3 py-2 text-sm text-muted"
          >
            {{ attribution }}
          </p>
          <p
            v-else-if="suggestionsUnavailable"
            class="px-3 py-2 text-sm text-muted"
          >
            {{ t('locations.suggestionsUnavailable') }}
          </p>
        </template>
      </UInputMenu>
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
    <!-- Disabled, not hidden: the Dispatcher still reads the values they typed. -->
    <fieldset
      :disabled="alreadySaved"
      class="m-0 min-w-0 border-0 p-0"
    >
      <div
        v-if="summaryLines.length > 0"
        id="transfer-form-summary"
        ref="summaryEl"
        tabindex="-1"
        role="alert"
        class="mb-4 rounded-md bg-error/10 p-3 text-default"
      >
        <p class="font-medium">
          {{ t('transfers.summary') }}
        </p>
        <ul class="mt-2 list-disc ps-5">
          <li
            v-for="line in summaryLines"
            :key="line"
          >
            {{ line }}
          </li>
        </ul>
      </div>

      <UFormField
        :label="t('transfers.client')"
        name="client"
        class="mb-4"
        :size="controlSize"
        :error="clientErrorKey ? t(clientErrorKey) : false"
      >
        <USelectMenu
          id="transfer-client"
          v-model="clientId"
          v-model:search-term="clientSearch"
          name="client"
          value-key="value"
          :items="clientItems"
          :placeholder="t('transfers.chooseClient')"
          :create-item="{ when: 'always', position: 'bottom' }"
          class="w-full"
          @create="onCreateClient"
        >
          <template #create-item-label>
            {{ namedAdd(clientSearch, t('transfers.addClient')) }}
          </template>
        </USelectMenu>
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <div
        v-if="clientOfficeNote"
        id="transfer-client-note"
        class="mb-4 text-sm"
      >
        <p class="font-medium text-default">
          {{ t('transfers.clientNote') }}
        </p>
        <p class="mt-1 whitespace-pre-wrap text-default">
          {{ clientOfficeNote }}
        </p>
      </div>
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
        :error="startErrorKey ? t(startErrorKey) : false"
      >
        <USelectMenu
          id="transfer-start"
          v-model="startLocationId"
          v-model:search-term="startSearch"
          name="start"
          value-key="value"
          :items="locationItems"
          :placeholder="t('transfers.chooseLocation')"
          :create-item="{ when: 'always', position: 'bottom' }"
          class="w-full"
          @create="onCreateStart"
        >
          <template #create-item-label>
            {{ namedAdd(startSearch, t('transfers.addLocation')) }}
          </template>
        </USelectMenu>
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('transfers.end')"
        name="end"
        class="mb-4"
        :size="controlSize"
        :error="endErrorKey ? t(endErrorKey) : false"
      >
        <USelectMenu
          id="transfer-end"
          v-model="endLocationId"
          v-model:search-term="endSearch"
          name="end"
          value-key="value"
          :items="locationItems"
          :placeholder="t('transfers.chooseLocation')"
          :create-item="{ when: 'always', position: 'bottom' }"
          class="w-full"
          @create="onCreateEnd"
        >
          <template #create-item-label>
            {{ namedAdd(endSearch, t('transfers.addLocation')) }}
          </template>
        </USelectMenu>
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
        v-if="asksGroupCount"
        :label="t('transfers.groupPassengers')"
        name="groupPassengers"
        class="mb-4"
        :size="controlSize"
        :error="groupErrorKey ? t(groupErrorKey) : false"
      >
        <UInput
          id="transfer-group-passengers"
          v-model="groupPassengers"
          name="groupPassengers"
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
        :label="t('transfers.clientReference')"
        name="clientReference"
        class="mb-4"
        :size="controlSize"
        :error="clientReferenceErrorKey ? t(clientReferenceErrorKey) : false"
      >
        <UInput
          id="transfer-client-reference"
          v-model="clientReference"
          name="clientReference"
          type="text"
          autocomplete="off"
          class="w-full"
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
        :error="paymentErrorKey ? t(paymentErrorKey) : false"
      >
        <USelect
          id="transfer-payment"
          v-model="payment"
          name="payment"
          :items="paymentItems"
          :placeholder="t('transfers.choosePayment')"
          class="w-full"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        v-if="!extraVehicle"
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

      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :size="controlSize"
        class="mb-4"
        :aria-expanded="moreOpen"
        aria-controls="transfer-more"
        @click="moreOpen = !moreOpen"
      >
        {{ t('transfers.more') }}
      </UButton>
      <div
        v-show="moreOpen"
        id="transfer-more"
      >
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
        <UCheckbox
          id="transfer-airport"
          v-model="airportMark"
          name="airport"
          :size="controlSize"
          class="mb-4"
          :label="t('transfers.airport')"
        />
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
      </div>
    </fieldset>
  </form>
  <!-- A route change of a main Transfer can copy onto unfinished extra vehicles.
       The box starts on. Left off, the save stays on this Transfer and the
       notice links to the group list. -->
  <UCheckbox
    v-if="offerApplyToExtraVehicles"
    id="transfer-apply-extras"
    v-model="applyToExtraVehicles"
    name="applyToExtraVehicles"
    :size="controlSize"
    class="mt-4"
    :label="t('transfers.applyToExtraVehicles')"
  />
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
      v-if="!alreadySaved"
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
