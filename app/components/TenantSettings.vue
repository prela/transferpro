<script setup lang="ts">
import type { TenantSettingsResponse } from '../../shared'
import { AIRPORT_WAIT_DEFAULT_MINUTES, ELSEWHERE_WAIT_DEFAULT_MINUTES, TENANT_TIME_ZONE_DEFAULT, tenantSettingsGetSchema, tenantSettingsResponseSchema, WAIT_MINUTES_MAX, WAIT_MINUTES_MIN } from '../../shared'

defineProps<{
  isAdmin: boolean
}>()

const emit = defineEmits<{
  saved: []
}>()

const { t } = useI18n()
// Zones the server will accept. GET sends them; the browser's Intl list is not used.
const allowedZones = ref<string[]>([])

const settings = ref<TenantSettingsResponse | null>(null)
const airportWaitMinutes = ref(AIRPORT_WAIT_DEFAULT_MINUTES)
const elsewhereWaitMinutes = ref(ELSEWHERE_WAIT_DEFAULT_MINUTES)
const timeZone = ref(TENANT_TIME_ZONE_DEFAULT)
const loading = ref(false)
const pending = ref(false)
const loadError = ref(false)
const saveError = ref(false)
const saved = ref(false)

/** The stored zone when this server's list no longer contains it. */
const unsupportedZone = computed(() => {
  const zone = settings.value?.timeZone
  if (!zone || allowedZones.value.includes(zone))
    return null
  return zone
})

const airportId = useId()
const elsewhereId = useId()
const timeZoneId = useId()

async function loadSettings() {
  loading.value = true
  loadError.value = false
  try {
    const body = tenantSettingsGetSchema.parse(await $fetch('/api/tenant-settings'))
    allowedZones.value = body.timeZones
    apply(body)
  }
  catch {
    loadError.value = true
  }
  finally {
    loading.value = false
  }
}

function apply(next: TenantSettingsResponse) {
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
    const body: { airportWaitMinutes: number, elsewhereWaitMinutes: number, timeZone?: string } = {
      airportWaitMinutes: airportWaitMinutes.value,
      elsewhereWaitMinutes: elsewhereWaitMinutes.value,
    }
    // An unchanged zone stays off the body, including one the list has dropped.
    if (settings.value && timeZone.value !== settings.value.timeZone)
      body.timeZone = timeZone.value
    apply(tenantSettingsResponseSchema.parse(await $fetch('/api/tenant-settings', {
      method: 'PATCH',
      body,
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
            v-if="unsupportedZone"
            :value="unsupportedZone"
          >
            {{ t('settings.timeZoneUnsupported', { zone: unsupportedZone }) }}
          </option>
          <option
            v-for="zone in allowedZones"
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
