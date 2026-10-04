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
const { notifyAuditChanged } = useAuditRefresh()
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

const zoneItems = computed(() => {
  const items = allowedZones.value.map(zone => ({ label: zone, value: zone }))
  if (unsupportedZone.value) {
    items.unshift({
      label: t('settings.timeZoneUnsupported', { zone: unsupportedZone.value }),
      value: unsupportedZone.value,
    })
  }
  return items
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
  <section>
    <h2 class="mt-6 mb-4 text-xl font-semibold">
      {{ t('settings.title') }}
    </h2>
    <p class="mb-4">
      {{ t('settings.intro') }}
    </p>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      :description="t('settings.loadFailed')"
    />
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
      <UAlert
        v-if="saveError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t('settings.saveFailed')"
      />
      <UAlert
        v-else-if="saved"
        color="success"
        variant="subtle"
        role="status"
        class="mb-4"
        :description="t('settings.saved')"
      />
      <UFormField
        :label="t('settings.airportWait')"
        class="mb-4"
        size="xl"
      >
        <UInput
          :id="airportId"
          v-model.number="airportWaitMinutes"
          type="number"
          inputmode="numeric"
          :min="WAIT_MINUTES_MIN"
          :max="WAIT_MINUTES_MAX"
          step="1"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField
        :label="t('settings.elsewhereWait')"
        class="mb-4"
        size="xl"
      >
        <UInput
          :id="elsewhereId"
          v-model.number="elsewhereWaitMinutes"
          type="number"
          inputmode="numeric"
          :min="WAIT_MINUTES_MIN"
          :max="WAIT_MINUTES_MAX"
          step="1"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField
        :label="t('settings.timeZone')"
        class="mb-4"
        size="xl"
      >
        <USelect
          :id="timeZoneId"
          v-model="timeZone"
          :items="zoneItems"
          required
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        size="xl"
        :disabled="pending"
      >
        {{ pending ? t('settings.saving') : t('settings.save') }}
      </UButton>
    </form>
    <div v-else>
      <p class="text-sm text-muted">
        {{ t('settings.airportWait') }}
      </p>
      <p>{{ settings.airportWaitMinutes }}</p>
      <p class="mt-4 text-sm text-muted">
        {{ t('settings.elsewhereWait') }}
      </p>
      <p>{{ settings.elsewhereWaitMinutes }}</p>
      <p class="mt-4 text-sm text-muted">
        {{ t('settings.timeZone') }}
      </p>
      <p>{{ settings.timeZone }}</p>
      <p class="mt-4">
        {{ t('settings.adminOnly') }}
      </p>
    </div>
  </section>
</template>
