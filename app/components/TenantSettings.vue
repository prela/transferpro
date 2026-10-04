<script setup lang="ts">
import type { TenantSettings } from '../../shared'
import { AIRPORT_WAIT_DEFAULT_MINUTES, ELSEWHERE_WAIT_DEFAULT_MINUTES, TENANT_TIME_ZONE_DEFAULT, tenantSettingsSchema, WAIT_MINUTES_MAX, WAIT_MINUTES_MIN } from '../../shared'

defineProps<{
  isAdmin: boolean
}>()

const emit = defineEmits<{
  saved: []
}>()

const { t } = useI18n()
const timeZones = Intl.supportedValuesOf('timeZone')

const settings = ref<TenantSettings | null>(null)
const airportWaitMinutes = ref(AIRPORT_WAIT_DEFAULT_MINUTES)
const elsewhereWaitMinutes = ref(ELSEWHERE_WAIT_DEFAULT_MINUTES)
const timeZone = ref(TENANT_TIME_ZONE_DEFAULT)
const loading = ref(false)
const pending = ref(false)
const loadError = ref(false)
const saveError = ref(false)
const saved = ref(false)

const airportId = useId()
const elsewhereId = useId()
const timeZoneId = useId()

async function loadSettings() {
  loading.value = true
  loadError.value = false
  try {
    apply(tenantSettingsSchema.parse(await $fetch('/api/tenant-settings')))
  }
  catch {
    loadError.value = true
  }
  finally {
    loading.value = false
  }
}

function apply(next: TenantSettings) {
  settings.value = next
  airportWaitMinutes.value = next.airportWaitMinutes
  elsewhereWaitMinutes.value = next.elsewhereWaitMinutes
  timeZone.value = next.timeZone
}

async function save() {
  saveError.value = false
  saved.value = false
  pending.value = true
  try {
    apply(tenantSettingsSchema.parse(await $fetch('/api/tenant-settings', {
      method: 'PATCH',
      body: {
        airportWaitMinutes: airportWaitMinutes.value,
        elsewhereWaitMinutes: elsewhereWaitMinutes.value,
        timeZone: timeZone.value,
      },
    })))
    saved.value = true
    emit('saved')
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
  <section>
    <h2>{{ t('settings.title') }}</h2>
    <p>{{ t('settings.intro') }}</p>
    <p
      v-if="loadError"
      class="error"
      role="alert"
    >
      {{ t('settings.loadFailed') }}
    </p>
    <p
      v-else-if="loading || !settings"
      role="status"
    >
      {{ t('settings.loading') }}
    </p>
    <form
      v-else-if="isAdmin"
      @submit.prevent="save"
    >
      <p
        v-if="saveError"
        class="error"
        role="alert"
      >
        {{ t('settings.saveFailed') }}
      </p>
      <p
        v-else-if="saved"
        role="status"
      >
        {{ t('settings.saved') }}
      </p>
      <div class="field">
        <label :for="airportId">{{ t('settings.airportWait') }}</label>
        <input
          :id="airportId"
          v-model.number="airportWaitMinutes"
          type="number"
          inputmode="numeric"
          :min="WAIT_MINUTES_MIN"
          :max="WAIT_MINUTES_MAX"
          step="1"
          required
        >
      </div>
      <div class="field">
        <label :for="elsewhereId">{{ t('settings.elsewhereWait') }}</label>
        <input
          :id="elsewhereId"
          v-model.number="elsewhereWaitMinutes"
          type="number"
          inputmode="numeric"
          :min="WAIT_MINUTES_MIN"
          :max="WAIT_MINUTES_MAX"
          step="1"
          required
        >
      </div>
      <div class="field">
        <label :for="timeZoneId">{{ t('settings.timeZone') }}</label>
        <select
          :id="timeZoneId"
          v-model="timeZone"
          required
        >
          <option
            v-for="zone in timeZones"
            :key="zone"
            :value="zone"
          >
            {{ zone }}
          </option>
        </select>
      </div>
      <button
        type="submit"
        :disabled="pending"
      >
        {{ pending ? t('settings.saving') : t('settings.save') }}
      </button>
    </form>
    <div v-else>
      <p class="label">
        {{ t('settings.airportWait') }}
      </p>
      <p>{{ settings.airportWaitMinutes }}</p>
      <p class="label">
        {{ t('settings.elsewhereWait') }}
      </p>
      <p>{{ settings.elsewhereWaitMinutes }}</p>
      <p class="label">
        {{ t('settings.timeZone') }}
      </p>
      <p>{{ settings.timeZone }}</p>
      <p>{{ t('settings.adminOnly') }}</p>
    </div>
  </section>
</template>
