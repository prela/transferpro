<script setup lang="ts">
import type { InvoicingVatRate } from '../../shared'
import { EMPTY_INVOICING_SETTINGS, INVOICING_DUE_DAYS_MAX, INVOICING_DUE_DAYS_MIN, INVOICING_VAT_RATES, invoicingSettingsSchema } from '../../shared'

/**
 * Računi on `/settings`. Admin only. The token field is write-only: after a
 * save the screen shows the last four characters and the input is empty.
 */
const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const dueDays = ref(EMPTY_INVOICING_SETTINGS.dueDays)
const vatRate = ref<InvoicingVatRate>(EMPTY_INVOICING_SETTINGS.vatRate)
const lineText = ref(EMPTY_INVOICING_SETTINGS.lineText)
const version = ref(EMPTY_INVOICING_SETTINGS.version)
const token = ref('')
const tokenSet = ref(false)
const tokenLastFour = ref<string | null>(null)
const loading = ref(false)
const pending = ref(false)
const loadError = ref(false)
const saveError = ref(false)
const saved = ref(false)

const dueDaysId = useId()
const vatRateId = useId()
const lineTextId = useId()
const tokenId = useId()

const vatItems = INVOICING_VAT_RATES.map(rate => ({ label: `${rate} %`, value: rate }))

function apply(body: { dueDays: number, vatRate: InvoicingVatRate, lineText: string, version: number, tokenSet: boolean, tokenLastFour: string | null }) {
  dueDays.value = body.dueDays
  vatRate.value = body.vatRate
  lineText.value = body.lineText
  version.value = body.version
  tokenSet.value = body.tokenSet
  tokenLastFour.value = body.tokenLastFour
  token.value = ''
}

async function loadSettings() {
  loading.value = true
  loadError.value = false
  try {
    apply(invoicingSettingsSchema.parse(await $fetch('/api/invoicing-settings')))
  }
  catch {
    loadError.value = true
  }
  finally {
    loading.value = false
  }
}

async function save() {
  saveError.value = false
  saved.value = false
  pending.value = true
  try {
    const body: {
      dueDays: number
      vatRate: InvoicingVatRate
      lineText: string
      version: number
      token?: string
    } = {
      dueDays: dueDays.value,
      vatRate: vatRate.value,
      lineText: lineText.value,
      version: version.value,
    }
    // A blank token leaves the stored one. The value is not kept in the field.
    const typed = token.value.trim()
    if (typed !== '')
      body.token = typed
    apply(invoicingSettingsSchema.parse(await $fetch('/api/invoicing-settings', {
      method: 'PUT',
      body,
    })))
    saved.value = true
    notifyAuditChanged()
  }
  catch {
    saveError.value = true
  }
  finally {
    pending.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <section
    class="mt-10"
    aria-labelledby="invoicing-settings-heading"
  >
    <h2
      id="invoicing-settings-heading"
      class="text-lg font-semibold"
    >
      {{ t('settings.invoicing.title') }}
    </h2>
    <p class="mt-1 text-sm text-muted">
      {{ t('settings.invoicing.intro') }}
    </p>
    <p
      v-if="loading"
      class="mt-4"
      role="status"
    >
      {{ t('settings.loading') }}
    </p>
    <UAlert
      v-else-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :description="t('settings.loadFailed')"
    />
    <form
      v-else
      id="invoicing-settings-form"
      class="mt-4"
      @submit.prevent="save"
    >
      <UAlert
        v-if="saveError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t('settings.saveFailed')"
      />
      <!-- A success alert's description is `opacity-90` and fails contrast on the light theme. -->
      <p
        v-else-if="saved"
        role="status"
        class="mb-4 text-sm"
      >
        {{ t('settings.saved') }}
      </p>
      <p
        v-if="tokenSet && tokenLastFour"
        class="mb-4 text-sm"
      >
        {{ t('settings.invoicing.tokenSet', { lastFour: tokenLastFour }) }}
      </p>
      <p
        v-else
        class="mb-4 text-sm text-muted"
      >
        {{ t('settings.invoicing.tokenMissing') }}
      </p>
      <!-- Desktop is two columns. The phone stays one column (ADR-0038). -->
      <div class="grid gap-4 lg:grid-cols-2">
        <UFormField
          :label="t('settings.invoicing.token')"
          :hint="t('settings.invoicing.tokenHint')"
          size="xl"
          class="lg:col-span-2"
        >
          <UInput
            :id="tokenId"
            v-model="token"
            type="password"
            autocomplete="off"
            size="xl"
            class="w-full"
          />
        </UFormField>
        <UFormField
          :label="t('settings.invoicing.dueDays')"
          size="xl"
        >
          <UInput
            :id="dueDaysId"
            v-model.number="dueDays"
            type="number"
            inputmode="numeric"
            :min="INVOICING_DUE_DAYS_MIN"
            :max="INVOICING_DUE_DAYS_MAX"
            step="1"
            required
            size="xl"
            class="w-full"
          />
        </UFormField>
        <UFormField
          :label="t('settings.invoicing.vatRate')"
          size="xl"
        >
          <USelect
            :id="vatRateId"
            v-model="vatRate"
            :items="vatItems"
            size="xl"
            class="w-full"
          />
        </UFormField>
        <UFormField
          :label="t('settings.invoicing.lineText')"
          size="xl"
          class="lg:col-span-2"
        >
          <UInput
            :id="lineTextId"
            v-model="lineText"
            type="text"
            required
            maxlength="100"
            size="xl"
            class="w-full"
          />
        </UFormField>
      </div>
      <UButton
        type="submit"
        size="xl"
        class="mt-4"
        :disabled="pending"
      >
        {{ pending ? t('settings.saving') : t('settings.save') }}
      </UButton>
    </form>
  </section>
</template>
