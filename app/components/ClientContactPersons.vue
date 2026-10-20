<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ContactPerson, DisplayLocale } from '../../shared'
import { z } from 'zod'
import { CONTACT_PERSON_NAME_MAX_LENGTH, CONTACT_PERSON_ROLE_MAX_LENGTH, contactPersonListSchema, contactPersonSchema, DRIVER_EMAIL_MAX_LENGTH, DRIVER_PHONE_MAX_LENGTH } from '../../shared'
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

const people = ref<ContactPerson[]>([])
const loading = ref(false)
const loadErrorKey = ref<ContactFailure | null>(null)
const formErrorKey = ref<ContactFailure | null>(null)
const saving = ref(false)
const formMode = ref<'add' | 'edit' | null>(null)
const editingId = ref<string | null>(null)
/** The version the form opened with. Only Osvježi replaces it (ADR-0046). */
const openedVersion = ref(0)
const staleNotice = ref(false)
const refreshing = ref(false)
const confirming = ref<ContactPerson | null>(null)
const removing = ref(false)

const state = reactive({ name: '', role: '', phone: '', email: '' })

type ContactFailure = 'clients.contacts.loadFailed' | 'clients.contacts.rejected' | 'clients.contacts.notFound' | 'clients.contacts.forbidden' | 'clients.contacts.signedOut' | 'clients.contacts.saveFailed'

interface ContactForm {
  name: string
  role: string
  phone: string
  email: string
}

/**
 * The row the form is on, as the list last read it. The 409 carries no name,
 * so the notice reads who and when from here. A removed person is absent,
 * and the notice then has no author (ADR-0046).
 */
const staleRow = computed(() => {
  const row = people.value.find(person => person.id === editingId.value)
  return row && row.version !== openedVersion.value ? row : null
})

const schema = computed(() => z.object({
  name: z.string().trim().min(1, t('clients.contacts.nameEmpty')).max(CONTACT_PERSON_NAME_MAX_LENGTH, t('clients.contacts.nameTooLong')),
  role: z.string().trim().max(CONTACT_PERSON_ROLE_MAX_LENGTH, t('clients.contacts.roleTooLong')),
  phone: z.string().trim().max(DRIVER_PHONE_MAX_LENGTH, t('clients.contacts.phoneTooLong')),
  email: z.string().trim().max(DRIVER_EMAIL_MAX_LENGTH).refine(
    value => value === '' || z.email().safeParse(value).success,
    { error: t('clients.contacts.emailInvalid') },
  ),
}).refine(value => value.phone !== '' || value.email !== '', {
  error: t('clients.contacts.unreachable'),
  path: ['phone'],
}))

const submitLabel = computed(() => {
  if (saving.value)
    return formMode.value === 'edit' ? t('clients.contacts.saving') : t('clients.contacts.submitting')
  return formMode.value === 'edit' ? t('clients.contacts.save') : t('clients.contacts.submit')
})

function failureKey(error: unknown): ContactFailure {
  switch (httpStatus(error)) {
    case 400: return 'clients.contacts.rejected'
    case 401: return 'clients.contacts.signedOut'
    case 403: return 'clients.contacts.forbidden'
    case 404: return 'clients.contacts.notFound'
    default: return 'clients.contacts.saveFailed'
  }
}

function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

async function loadPeople() {
  loading.value = true
  loadErrorKey.value = null
  try {
    people.value = contactPersonListSchema.parse(await $fetch(`/api/clients/${props.clientId}/contact-persons`)).contactPersons
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'clients.contacts.saveFailed' ? 'clients.contacts.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

async function rereadPeople(): Promise<boolean> {
  try {
    people.value = contactPersonListSchema.parse(await $fetch(`/api/clients/${props.clientId}/contact-persons`)).contactPersons
    return true
  }
  catch {
    return false
  }
}

function openAdd() {
  editingId.value = null
  openedVersion.value = 0
  state.name = ''
  state.role = ''
  state.phone = ''
  state.email = ''
  formErrorKey.value = null
  staleNotice.value = false
  formMode.value = 'add'
}

function openEdit(person: ContactPerson) {
  editingId.value = person.id
  openedVersion.value = person.version
  state.name = person.name
  state.role = person.role ?? ''
  state.phone = person.phone ?? ''
  state.email = person.email ?? ''
  formErrorKey.value = null
  staleNotice.value = false
  formMode.value = 'edit'
}

function closeForm() {
  formMode.value = null
  editingId.value = null
  staleNotice.value = false
}

async function noteStale() {
  await rereadPeople()
  staleNotice.value = true
}

/** Osvježi replaces the form. A person who was removed is no longer on the list. */
async function refreshStale() {
  if (refreshing.value)
    return
  refreshing.value = true
  try {
    if (!await rereadPeople())
      return
    const row = people.value.find(person => person.id === editingId.value)
    if (!row) {
      closeForm()
      return
    }
    openEdit(row)
  }
  finally {
    refreshing.value = false
  }
}

async function onSubmit(event: FormSubmitEvent<ContactForm>) {
  formErrorKey.value = null
  saving.value = true
  const body = {
    name: event.data.name.trim(),
    role: blank(event.data.role),
    phone: blank(event.data.phone),
    email: blank(event.data.email),
  }
  try {
    if (formMode.value === 'edit') {
      const id = editingId.value
      if (!id)
        return
      contactPersonSchema.parse(await $fetch(`/api/clients/${props.clientId}/contact-persons/${id}`, {
        method: 'PATCH',
        body: { ...body, version: openedVersion.value },
      }))
    }
    else {
      contactPersonSchema.parse(await $fetch(`/api/clients/${props.clientId}/contact-persons`, {
        method: 'POST',
        body,
      }))
    }
    closeForm()
    notifyAuditChanged()
    await loadPeople()
  }
  catch (error) {
    if (errorCode(error) === 'stale_save')
      await noteStale()
    else
      formErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

async function confirmRemove() {
  const person = confirming.value
  if (!person || removing.value)
    return
  removing.value = true
  formErrorKey.value = null
  try {
    await $fetch(`/api/clients/${props.clientId}/contact-persons/${person.id}/remove`, {
      method: 'POST',
      body: { version: person.version },
    })
    if (editingId.value === person.id)
      closeForm()
    confirming.value = null
    notifyAuditChanged()
    await loadPeople()
  }
  catch (error) {
    if (errorCode(error) === 'stale_save') {
      editingId.value = person.id
      openedVersion.value = person.version
      confirming.value = null
      await noteStale()
    }
    else {
      formErrorKey.value = failureKey(error)
      confirming.value = null
    }
  }
  finally {
    removing.value = false
  }
}

onMounted(loadPeople)
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
      :description="t(loadErrorKey ?? formErrorKey ?? 'clients.contacts.saveFailed')"
    />
    <p
      v-if="loading"
      role="status"
    >
      {{ t('clients.contacts.loading') }}
    </p>
    <ul
      v-else
      class="mb-4 space-y-3"
    >
      <li
        v-for="person in people"
        :key="person.id"
        class="border-b border-default pb-3"
      >
        <button
          type="button"
          class="block min-h-7 text-left font-medium max-lg:min-h-11 max-lg:text-base"
          @click="openEdit(person)"
        >
          {{ person.name }}
        </button>
        <p
          v-if="person.role"
          class="text-sm text-muted"
        >
          {{ person.role }}
        </p>
        <p
          v-if="person.phone"
          class="text-sm"
        >
          <a
            class="inline-flex items-center text-primary underline"
            :class="commandControlClass(phone)"
            :href="`tel:${person.phone}`"
          >{{ person.phone }}</a>
        </p>
        <p
          v-if="person.email"
          class="text-sm"
        >
          <a
            class="inline-flex items-center text-primary underline"
            :class="commandControlClass(phone)"
            :href="`mailto:${person.email}`"
          >{{ person.email }}</a>
        </p>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          class="mt-2"
          :size="commandControlSize(phone)"
          :class="commandControlClass(phone)"
          :aria-label="t('clients.contacts.removeNamed', { name: person.name })"
          @click="confirming = person"
        >
          {{ t('clients.contacts.remove') }}
        </UButton>
      </li>
    </ul>
    <UEmpty
      v-if="!loading && people.length === 0 && formMode === null"
      :title="t('clients.contacts.empty')"
      icon="i-lucide-contact"
      variant="naked"
    />
    <UButton
      v-if="formMode === null"
      type="button"
      class="mt-4"
      :size="commandControlSize(phone)"
      :class="commandControlClass(phone)"
      @click="openAdd"
    >
      {{ t('clients.contacts.add') }}
    </UButton>
    <UForm
      v-else
      id="contact-person-form"
      :schema="schema"
      :state="state"
      :validate-on="[]"
      class="space-y-4"
      :class="commandInputClass"
      @submit="onSubmit"
      @error="formErrorKey = null"
    >
      <p class="font-medium">
        {{ formMode === 'edit' ? t('clients.contacts.edit') : t('clients.contacts.add') }}
      </p>
      <UFormField
        :label="t('clients.contacts.name')"
        name="name"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.name"
          name="name"
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
        :label="t('clients.contacts.role')"
        name="role"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.role"
          name="role"
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
        :label="t('clients.contacts.phone')"
        name="phone"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.phone"
          name="phone"
          type="tel"
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
        :label="t('clients.contacts.email')"
        name="email"
        :size="phone ? 'xl' : 'sm'"
      >
        <UInput
          v-model="state.email"
          name="email"
          type="email"
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
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="commandControlSize(phone)"
          :class="commandControlClass(phone)"
          :disabled="saving"
          @click="closeForm"
        >
          {{ t('clients.contacts.cancel') }}
        </UButton>
        <UButton
          type="submit"
          :size="commandControlSize(phone)"
          :class="commandControlClass(phone)"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </div>
    </UForm>

    <UModal
      :open="confirming !== null"
      :title="t('clients.contacts.remove')"
      :dismissible="!removing"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
      @update:open="(open: boolean) => { if (!open) confirming = null }"
    >
      <template #body>
        <p>{{ t('clients.contacts.confirmRemove') }}</p>
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :size="commandControlSize(phone)"
          :class="commandControlClass(phone)"
          :disabled="removing"
          @click="confirming = null"
        >
          {{ t('clients.contacts.cancel') }}
        </UButton>
        <UButton
          type="button"
          :size="commandControlSize(phone)"
          :class="commandControlClass(phone)"
          :loading="removing"
          @click="confirmRemove"
        >
          {{ t('clients.contacts.remove') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
