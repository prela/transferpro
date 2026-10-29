<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ClientBilling, DisplayLocale, IsoCountry } from '../../shared'
import { z } from 'zod'
import { BILLING_ADDRESS_MAX_LENGTH, BILLING_LEGAL_NAME_MAX_LENGTH, BILLING_OIB_COUNTRY, BILLING_VAT_ID_MAX_LENGTH, clientBillingSchema, ISO_3166_1_ALPHA_2, isValidOib } from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'
import { errorCode, httpStatus } from '../transfer-day-http'

const props = defineProps<{
  clientId: string
  /** Phone uses the large target. Desktop uses the office size. */
  phone: boolean
  timeZone: string
  locale: DisplayLocale
}>()

const { t, locale } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const current = ref<ClientBilling | null>(null)
const loading = ref(false)
const loadErrorKey = ref<BillingFailure | null>(null)
const formErrorKey = ref<BillingFailure | null>(null)
const saving = ref(false)
/** The version the form opened with. Null until the first save. Only Osvježi replaces it (ADR-0046). */
const openedVersion = ref<number | null>(null)
const staleNotice = ref(false)
const refreshing = ref(false)
const state = reactive<{
  legalName: string
  country: IsoCountry | undefined
  oib: string
  vatId: string
  address: string
  guestNameOnInvoice: boolean
}>({
  legalName: '',
  country: undefined,
  oib: '',
  vatId: '',
  address: '',
  guestNameOnInvoice: false,
})

type BillingFailure = 'clients.billing.loadFailed' | 'clients.billing.rejected' | 'clients.billing.notFound' | 'clients.billing.forbidden' | 'clients.billing.signedOut' | 'clients.billing.saveFailed'

interface BillingForm {
  legalName: string
  country: IsoCountry
  oib: string
  vatId: string
  address: string
  guestNameOnInvoice: boolean
}

/**
 * The row as it was last read. The 409 carries no name, so the notice
 * reads who and when from here. Until that version moves past the opened
 * one, the read has not seen the winning save.
 */
const staleRow = computed(() => {
  const row = current.value
  return row && row.version !== openedVersion.value ? row : null
})

const countryItems = computed(() => {
  const names = new Intl.DisplayNames([locale.value], { type: 'region' })
  return ISO_3166_1_ALPHA_2.map(code => ({
    label: names.of(code) ?? code,
    value: code,
  })).sort((left, right) => left.label.localeCompare(right.label, locale.value))
})

// The search field is not the label. The country name stays on the combobox.
const countrySearch = computed(() => ({
  'aria-label': t('clients.billing.country'),
  'autofocus': false as const,
}))

const schema = computed(() => z.object({
  legalName: z.string().trim().min(1, t('clients.billing.legalNameEmpty')).max(BILLING_LEGAL_NAME_MAX_LENGTH, t('clients.billing.legalNameTooLong')),
  country: z.enum(ISO_3166_1_ALPHA_2, { error: t('clients.billing.countryInvalid') }),
  oib: z.string(),
  vatId: z.string().trim().max(BILLING_VAT_ID_MAX_LENGTH, t('clients.billing.vatTooLong')),
  address: z.string().trim().min(1, t('clients.billing.addressEmpty')).max(BILLING_ADDRESS_MAX_LENGTH, t('clients.billing.addressTooLong')),
  guestNameOnInvoice: z.boolean(),
}).superRefine((value, context) => {
  const oib = value.oib.trim()
  if (value.country === BILLING_OIB_COUNTRY && oib === '') {
    context.addIssue({ code: 'custom', path: ['oib'], message: t('clients.billing.oibRequired') })
    return
  }
  if (oib !== '' && !isValidOib(oib))
    context.addIssue({ code: 'custom', path: ['oib'], message: t('clients.billing.oibInvalid') })
}))

const submitLabel = computed(() => saving.value ? t('clients.billing.saving') : t('clients.billing.save'))

function failureKey(error: unknown): BillingFailure {
  switch (httpStatus(error)) {
    case 400: return 'clients.billing.rejected'
    case 401: return 'clients.billing.signedOut'
    case 403: return 'clients.billing.forbidden'
    case 404: return 'clients.billing.notFound'
    default: return 'clients.billing.saveFailed'
  }
}

function show(billing: ClientBilling) {
  current.value = billing
  openedVersion.value = billing.version
  state.legalName = billing.legalName ?? ''
  state.country = billing.country ?? undefined
  state.oib = billing.oib ?? ''
  state.vatId = billing.vatId ?? ''
  state.address = billing.address ?? ''
  state.guestNameOnInvoice = billing.guestNameOnInvoice
  staleNotice.value = false
}

async function loadBilling() {
  loading.value = true
  loadErrorKey.value = null
  try {
    show(clientBillingSchema.parse(await $fetch(`/api/clients/${props.clientId}/billing-details`)))
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'clients.billing.saveFailed' ? 'clients.billing.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

async function rereadBilling(): Promise<boolean> {
  try {
    current.value = clientBillingSchema.parse(await $fetch(`/api/clients/${props.clientId}/billing-details`))
    return true
  }
  catch {
    return false
  }
}

async function noteStale() {
  // The 409 carries no name. The row does. The typed values and the opened
  // version stay until Osvježi. A failed read leaves the unknown-author sentence.
  await rereadBilling()
  staleNotice.value = true
}

/** Osvježi: the current values and version replace the form. A failed read keeps the notice. */
async function refreshStale() {
  if (refreshing.value)
    return
  refreshing.value = true
  try {
    if (!await rereadBilling())
      return
    const row = current.value
    if (!row)
      return
    show(row)
  }
  finally {
    refreshing.value = false
  }
}

async function onSubmit(event: FormSubmitEvent<BillingForm>) {
  formErrorKey.value = null
  saving.value = true
  const oib = event.data.oib.trim()
  const vatId = event.data.vatId.trim()
  const fields = {
    legalName: event.data.legalName,
    country: event.data.country,
    oib: oib === '' ? null : oib,
    vatId: vatId === '' ? null : vatId,
    address: event.data.address,
    guestNameOnInvoice: event.data.guestNameOnInvoice,
  }
  const body = openedVersion.value === null ? fields : { ...fields, version: openedVersion.value }
  try {
    const saved = clientBillingSchema.parse(await $fetch(`/api/clients/${props.clientId}/billing-details`, {
      method: 'PUT',
      body,
    }))
    show(saved)
    notifyAuditChanged()
  }
  catch (error) {
    // Awaited so the notice is up before the save button enables again.
    if (errorCode(error) === 'stale_save')
      await noteStale()
    else
      formErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

onMounted(loadBilling)
</script>

<template>
  <section>
    <StaleSaveAlert
      v-if="staleNotice"
      :changed-by-name="staleRow?.changedByName ?? null"
      :changed-at="staleRow?.changedAt ?? null"
      :time-zone="timeZone"
      :locale="locale"
      :phone="phone"
      :pending="refreshing"
      @refresh="refreshStale"
    />
    <UAlert
      v-if="loadErrorKey || formErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(loadErrorKey ?? formErrorKey ?? 'clients.billing.saveFailed')"
    />
    <p
      v-if="loading"
      role="status"
    >
      {{ t('clients.billing.loading') }}
    </p>
    <UForm
      v-else-if="!loadErrorKey"
      id="client-billing-form"
      :schema="schema"
      :state="state"
      :validate-on="[]"
      class="space-y-4"
      :class="commandInputClass"
      @submit="onSubmit"
      @error="formErrorKey = null"
    >
      <UFormField
        :label="t('clients.billing.legalName')"
        name="legalName"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.legalName"
          name="legalName"
          type="text"
          autocomplete="organization"
          class="w-full"
        />
        <template #error="{ error }">
          <span
            v-if="error"
            role="alert"
          >{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('clients.billing.country')"
        name="country"
        :size="phone ? 'xl' : 'sm'"
      >
        <USelectMenu
          v-model="state.country"
          name="country"
          value-key="value"
          :items="countryItems"
          :search-input="countrySearch"
          virtualize
          class="w-full"
        />
        <template #error="{ error }">
          <span
            v-if="error"
            role="alert"
          >{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('clients.billing.oib')"
        name="oib"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.oib"
          name="oib"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          class="w-full"
        />
        <template #error="{ error }">
          <span
            v-if="error"
            role="alert"
          >{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('clients.billing.vatId')"
        name="vatId"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.vatId"
          name="vatId"
          type="text"
          autocomplete="off"
          class="w-full"
        />
        <template #error="{ error }">
          <span
            v-if="error"
            role="alert"
          >{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('clients.billing.address')"
        name="address"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.address"
          name="address"
          type="text"
          autocomplete="street-address"
          class="w-full"
        />
        <template #error="{ error }">
          <span
            v-if="error"
            role="alert"
          >{{ error }}</span>
        </template>
      </UFormField>
      <UCheckbox
        v-model="state.guestNameOnInvoice"
        name="guestNameOnInvoice"
        :label="t('clients.billing.guestName')"
        :ui="{ label: 'max-lg:text-base' }"
      />
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <UButton
          type="submit"
          :size="commandControlSize(phone)"
          class="w-full justify-center sm:w-auto"
          :class="commandControlClass(phone)"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </div>
    </UForm>
  </section>
</template>
