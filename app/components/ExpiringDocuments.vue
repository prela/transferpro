<script setup lang="ts">
import type { ExpiringDocument } from '../../shared'
import { expiringDocumentListSchema } from '../../shared'

const props = withDefaults(defineProps<{
  showRefresh?: boolean
  /** `notice` is the Driver row: one line, and only when something expires. */
  variant?: 'list' | 'notice'
}>(), {
  showRefresh: true,
  variant: 'list',
})

const { t, locale } = useI18n()
const titleId = useId()

const documents = ref<ExpiringDocument[]>([])
// Start true so the empty copy does not flash before the first read.
const loading = ref(true)
const loadError = ref(false)
// A slower reload must not replace the rows from a newer one.
let loadTicket = 0
// A later read keeps the rows. The first read may show the loading copy.
let attempted = false

async function loadDocuments() {
  const ticket = ++loadTicket
  const first = !attempted
  attempted = true
  if (first)
    loading.value = true
  try {
    const next = expiringDocumentListSchema.parse(await $fetch('/api/expiring-documents')).documents
    if (ticket !== loadTicket)
      return
    documents.value = next
    loadError.value = false
  }
  catch {
    if (ticket !== loadTicket)
      return
    // A failed refresh keeps the rows. The first read has none to keep.
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

const noticeOpen = ref(false)

defineExpose({ reload: loadDocuments })

// The Driver row is loaded with the Ride list. The office list loads itself.
onMounted(() => {
  if (props.variant !== 'notice')
    void loadDocuments()
})
</script>

<template>
  <template v-if="props.variant === 'notice'">
    <section
      v-if="documents.length > 0 || loadError"
      :aria-label="t('expiringDocuments.title')"
    >
      <UAlert
        v-if="loadError && documents.length === 0"
        color="error"
        variant="subtle"
        role="alert"
        :description="t('expiringDocuments.loadFailed')"
      />
      <!--
      One row at the top of the Driver phone, and nothing when the list is
      empty (ADR-0038). A tap shows which documents expire.
    -->
      <button
        v-if="documents.length > 0"
        type="button"
        class="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-default bg-default px-3 text-left"
        :aria-expanded="noticeOpen"
        @click="noticeOpen = !noticeOpen"
      >
        <span>{{ t('expiringDocuments.title') }}</span>
        <span class="tabular-nums">{{ documents.length }}</span>
      </button>
      <ul
        v-if="noticeOpen && documents.length > 0"
        class="mt-2 flex flex-col gap-3"
      >
        <li
          v-for="document in documents"
          :key="documentKey(document)"
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
    </section>
  </template>
  <section
    v-else
    :aria-labelledby="titleId"
  >
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
      class="mb-4"
      :description="t('expiringDocuments.loadFailed')"
    />
    <p
      v-if="loading && documents.length === 0"
      role="status"
    >
      {{ t('expiringDocuments.loading') }}
    </p>
    <p v-else-if="!loading && documents.length === 0 && !loadError">
      {{ t('expiringDocuments.empty') }}
    </p>
    <!--
      One list for every role. The server decides who is on it: the office
      sees the Tenant, a driver sees only their own licences. A refresh
      keeps these rows on screen (ADR-0039).
    -->
    <ul
      v-else-if="documents.length > 0"
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
