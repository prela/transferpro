<script setup lang="ts">
import type { ExpiringDocument } from '../../shared'
import { expiringDocumentListSchema } from '../../shared'

const props = withDefaults(defineProps<{
  showRefresh?: boolean
}>(), {
  showRefresh: true,
})

const { t, locale } = useI18n()
const titleId = useId()

const documents = ref<ExpiringDocument[]>([])
// Start true so the empty copy does not flash before the first read.
const loading = ref(true)
const loadError = ref(false)
// A slower reload must not replace the rows from a newer one.
let loadTicket = 0

async function loadDocuments() {
  const ticket = ++loadTicket
  loading.value = true
  loadError.value = false
  try {
    const next = expiringDocumentListSchema.parse(await $fetch('/api/expiring-documents')).documents
    if (ticket !== loadTicket)
      return
    documents.value = next
  }
  catch {
    if (ticket !== loadTicket)
      return
    loadError.value = true
  }
  finally {
    if (ticket === loadTicket)
      loading.value = false
  }
}

/**
 * The same calendar-day shape as the Driver and Vehicle lists.
 * Croatian drops the leading zero. English keeps the ISO padding.
 */
function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day)
    return iso
  if (locale.value === 'hr')
    return `${Number(day)}.${Number(month)}.${year}.`
  return `${day}/${month}/${year}`
}

function documentKey(document: ExpiringDocument): string {
  return `${document.subject}:${document.subjectId}:${document.kind}`
}

defineExpose({ reload: loadDocuments })

onMounted(loadDocuments)
</script>

<template>
  <section :aria-labelledby="titleId">
    <h2
      :id="titleId"
      class="mt-6 mb-4 text-xl font-semibold"
    >
      {{ t('expiringDocuments.title') }}
    </h2>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      role="alert"
      :description="t('expiringDocuments.loadFailed')"
    />
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('expiringDocuments.loading') }}
    </p>
    <p v-else-if="documents.length === 0">
      {{ t('expiringDocuments.empty') }}
    </p>
    <!--
      One list for every role. The server decides who is on it: the office
      sees the Tenant, a driver sees only their own licences.
    -->
    <ul
      v-else
      class="flex flex-col gap-4"
      :aria-label="t('expiringDocuments.title')"
    >
      <li
        v-for="document in documents"
        :key="documentKey(document)"
        class="flex flex-col gap-1"
      >
        <p class="font-medium">
          {{ document.subjectLabel }}
        </p>
        <p>{{ t(`expiringDocuments.kinds.${document.kind}`) }}</p>
        <time :datetime="document.expiresOn">
          {{ formatDay(document.expiresOn) }}
        </time>
        <UBadge
          class="w-fit"
          :color="document.status === 'expired' ? 'error' : 'warning'"
          variant="subtle"
        >
          {{ t(`expiringDocuments.${document.status}`) }}
        </UBadge>
      </li>
    </ul>
    <UButton
      v-if="props.showRefresh"
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      class="mt-4"
      :disabled="loading"
      @click="loadDocuments"
    >
      {{ t('expiringDocuments.refresh') }}
    </UButton>
  </section>
</template>
