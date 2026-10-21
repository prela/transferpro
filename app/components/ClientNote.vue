<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ClientNote, DisplayLocale } from '../../shared'
import { z } from 'zod'
import { CLIENT_NOTE_MAX_LENGTH, clientNoteSchema } from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'
import { errorCode, httpStatus } from '../transfer-day-http'

const props = defineProps<{
  clientId: string
  /** Phone uses the large target. Desktop uses the office size. */
  phone: boolean
  timeZone: string
  locale: DisplayLocale
}>()

const { t } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()

const current = ref<ClientNote | null>(null)
const loading = ref(false)
const loadErrorKey = ref<NoteFailure | null>(null)
const formErrorKey = ref<NoteFailure | null>(null)
const saving = ref(false)
/** The version the form opened with. Null until the first save. Only Osvježi replaces it (ADR-0046). */
const openedVersion = ref<number | null>(null)
const staleNotice = ref(false)
const refreshing = ref(false)
const state = reactive({ note: '' })

type NoteFailure = 'clients.note.loadFailed' | 'clients.note.rejected' | 'clients.note.notFound' | 'clients.note.forbidden' | 'clients.note.signedOut' | 'clients.note.saveFailed'

interface NoteForm {
  note: string
}

/**
 * The note as it was last read. The 409 carries no name, so the notice
 * reads who and when from here. Until that version moves past the opened
 * one, the read has not seen the winning save.
 */
const staleRow = computed(() => {
  const row = current.value
  return row && row.version !== openedVersion.value ? row : null
})

const schema = computed(() => z.object({
  // Trim first, the same order as the route. A space around a 2000-character note is still that note.
  note: z.string().trim().max(CLIENT_NOTE_MAX_LENGTH, t('clients.note.tooLong')),
}))

const submitLabel = computed(() => saving.value ? t('clients.note.saving') : t('clients.note.save'))

function failureKey(error: unknown): NoteFailure {
  switch (httpStatus(error)) {
    case 400: return 'clients.note.rejected'
    case 401: return 'clients.note.signedOut'
    case 403: return 'clients.note.forbidden'
    case 404: return 'clients.note.notFound'
    default: return 'clients.note.saveFailed'
  }
}

function show(note: ClientNote) {
  current.value = note
  openedVersion.value = note.version
  state.note = note.note ?? ''
  staleNotice.value = false
}

async function loadNote() {
  loading.value = true
  loadErrorKey.value = null
  try {
    show(clientNoteSchema.parse(await $fetch(`/api/clients/${props.clientId}/note`)))
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'clients.note.saveFailed' ? 'clients.note.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

async function rereadNote(): Promise<boolean> {
  try {
    current.value = clientNoteSchema.parse(await $fetch(`/api/clients/${props.clientId}/note`))
    return true
  }
  catch {
    return false
  }
}

async function noteStale() {
  // The 409 carries no name. The note does. The typed text and the opened
  // version stay until Osvježi. A failed read leaves the unknown-author sentence.
  await rereadNote()
  staleNotice.value = true
}

/** Osvježi: the current text and version replace the form. A failed read keeps the notice. */
async function refreshStale() {
  if (refreshing.value)
    return
  refreshing.value = true
  try {
    if (!await rereadNote())
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

async function onSubmit(event: FormSubmitEvent<NoteForm>) {
  formErrorKey.value = null
  saving.value = true
  const body = openedVersion.value === null
    ? { note: event.data.note }
    : { note: event.data.note, version: openedVersion.value }
  try {
    const saved = clientNoteSchema.parse(await $fetch(`/api/clients/${props.clientId}/note`, {
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

onMounted(loadNote)
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
      :description="t(loadErrorKey ?? formErrorKey ?? 'clients.note.saveFailed')"
    />
    <p
      v-if="loading"
      role="status"
    >
      {{ t('clients.note.loading') }}
    </p>
    <UForm
      v-else-if="!loadErrorKey"
      id="client-note-form"
      :schema="schema"
      :state="state"
      :validate-on="[]"
      class="space-y-4"
      :class="commandInputClass"
      @submit="onSubmit"
      @error="formErrorKey = null"
    >
      <UFormField
        :label="t('clients.note.label')"
        name="note"
        :size="phone ? 'xl' : 'sm'"
      >
        <UTextarea
          v-model="state.note"
          name="note"
          :rows="4"
          class="w-full"
        />
        <template #error="{ error }">
          <span
            v-if="error"
            role="alert"
          >{{ error }}</span>
        </template>
      </UFormField>
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
