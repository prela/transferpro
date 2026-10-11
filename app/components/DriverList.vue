<script setup lang="ts">
import type { Driver, DriverKind } from '../../shared'
import { driverDateError, driverEmailError, driverKindError, driverListSchema, driverNameError, driverPhoneError, driverSchema, memberListSchema } from '../../shared'

const props = defineProps<{
  isAdmin: boolean
}>()

const { t, locale } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const titleId = useId()
const listTitleId = useId()

/**
 * Reka UI refuses a SelectItem whose value is `''`: that string is reserved
 * for clearing the select. "No account" is a real choice, so it needs its own value.
 * The API still receives no memberUserId, or null when a link is cleared.
 */
const noAccount = 'no-account'

const drivers = ref<Driver[]>([])
const members = ref<Array<{ userId: string, name: string }>>([])
const loading = ref(false)
const loadErrorKey = ref<DriverFailure | null>(null)
const formErrorKey = ref<DriverFailure | null>(null)
const pending = ref(false)

const name = ref('')
const kind = ref<DriverKind>()
const phone = ref('')
const email = ref('')
const driving = ref('')
const transport = ref('')
const memberUserId = ref(noAccount)
const nameErrorKey = ref<NameErrorKey | null>(null)
const kindErrorKey = ref<'drivers.kindInvalid' | null>(null)
const phoneErrorKey = ref<PhoneErrorKey | null>(null)
const emailErrorKey = ref<'drivers.emailInvalid' | null>(null)
const drivingErrorKey = ref<'drivers.dateInvalid' | null>(null)
const transportErrorKey = ref<'drivers.dateInvalid' | null>(null)

const editing = ref<Driver | null>(null)
const editName = ref('')
const editKind = ref<DriverKind>()
const editPhone = ref('')
const editEmail = ref('')
const editDriving = ref('')
const editTransport = ref('')
const editMemberUserId = ref(noAccount)
const editMustAccept = ref(false)
const editNameErrorKey = ref<NameErrorKey | null>(null)
const editKindErrorKey = ref<'drivers.kindInvalid' | null>(null)
const editPhoneErrorKey = ref<PhoneErrorKey | null>(null)
const editEmailErrorKey = ref<'drivers.emailInvalid' | null>(null)
const editDrivingErrorKey = ref<'drivers.dateInvalid' | null>(null)
const editTransportErrorKey = ref<'drivers.dateInvalid' | null>(null)
const editErrorKey = ref<DriverFailure | null>(null)
const saving = ref(false)

type NameErrorKey = 'drivers.nameEmpty' | 'drivers.nameTooLong'
type PhoneErrorKey = 'drivers.phoneEmpty' | 'drivers.phoneTooLong'
type DriverFailure = 'drivers.loadFailed' | 'drivers.rejected' | 'drivers.notFound' | 'drivers.forbidden' | 'drivers.signedOut' | 'drivers.saveFailed'

const kindItems = computed(() => [
  { label: t('drivers.kinds.own'), value: 'own' as const },
  { label: t('drivers.kinds.external'), value: 'external' as const },
])

const memberItems = computed(() => [
  { label: t('drivers.noAccount'), value: noAccount },
  ...members.value.map(member => ({ label: member.name, value: member.userId })),
])

const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('drivers.name') },
  { id: 'kind', header: t('drivers.kind') },
  { accessorKey: 'phone' as const, header: t('drivers.phone') },
  { accessorKey: 'email' as const, header: t('drivers.email') },
  { id: 'driving', header: t('drivers.drivingLicenceExpiresOn') },
  { id: 'transport', header: t('drivers.transportLicenceExpiresOn') },
  { id: 'member', header: t('drivers.member') },
  { id: 'mustAccept', header: t('drivers.mustAccept') },
  { id: 'actions', header: '' },
])

const editOpen = computed({
  get: () => editing.value !== null,
  set(open: boolean) {
    if (!open && !saving.value)
      editing.value = null
  },
})

function failureKey(error: unknown): DriverFailure {
  switch (httpStatus(error)) {
    case 400: return 'drivers.rejected'
    case 401: return 'drivers.signedOut'
    case 403: return 'drivers.forbidden'
    case 404: return 'drivers.notFound'
    default: return 'drivers.saveFailed'
  }
}

function nameKey(value: string): NameErrorKey | null {
  const problem = driverNameError(value)
  if (problem === 'empty')
    return 'drivers.nameEmpty'
  if (problem === 'too-long')
    return 'drivers.nameTooLong'
  return null
}

function phoneKey(value: string): PhoneErrorKey | null {
  const problem = driverPhoneError(value)
  if (problem === 'empty')
    return 'drivers.phoneEmpty'
  if (problem === 'too-long')
    return 'drivers.phoneTooLong'
  return null
}

function emailKey(value: string): 'drivers.emailInvalid' | null {
  return driverEmailError(value) === null ? null : 'drivers.emailInvalid'
}

/** The column is a calendar date. Format the parts so a zone cannot shift the day. */
function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day)
    return iso
  if (locale.value === 'hr')
    return `${Number(day)}.${Number(month)}.${year}.`
  return `${day}/${month}/${year}`
}

function memberLabel(userId: string | null): string {
  if (userId === null)
    return t('drivers.noAccount')
  return members.value.find(member => member.userId === userId)?.name ?? t('drivers.memberGone')
}

async function loadMembers() {
  try {
    const next = memberListSchema.parse(await $fetch('/api/members')).members
    members.value = next.filter(member => member.role === 'driver')
  }
  catch {
    members.value = []
  }
}

async function loadDrivers() {
  loading.value = true
  loadErrorKey.value = null
  try {
    const next = driverListSchema.parse(await $fetch('/api/drivers')).drivers
    drivers.value = next
  }
  catch (error) {
    loadErrorKey.value = failureKey(error) === 'drivers.saveFailed' ? 'drivers.loadFailed' : failureKey(error)
  }
  finally {
    loading.value = false
  }
}

function memberBody(value: string): { memberUserId: string } | Record<string, never> {
  return value === noAccount ? {} : { memberUserId: value }
}

function emailBody(value: string, linked: boolean): { email: string } | Record<string, never> {
  // A linked Driver takes the sign-in email. The office does not send another.
  if (linked)
    return {}
  const trimmed = value.trim()
  return trimmed === '' ? {} : { email: trimmed }
}

async function addDriver() {
  const chosen = kind.value
  const linked = memberUserId.value !== noAccount
  nameErrorKey.value = nameKey(name.value)
  phoneErrorKey.value = phoneKey(phone.value)
  emailErrorKey.value = linked ? null : emailKey(email.value)
  kindErrorKey.value = driverKindError(chosen ?? '') ? 'drivers.kindInvalid' : null
  drivingErrorKey.value = driverDateError(driving.value) ? 'drivers.dateInvalid' : null
  transportErrorKey.value = driverDateError(transport.value) ? 'drivers.dateInvalid' : null
  formErrorKey.value = null
  if (nameErrorKey.value || phoneErrorKey.value || emailErrorKey.value || kindErrorKey.value || drivingErrorKey.value || transportErrorKey.value || chosen === undefined)
    return
  pending.value = true
  try {
    driverSchema.parse(await $fetch('/api/drivers', {
      method: 'POST',
      body: {
        name: name.value,
        kind: chosen,
        phone: phone.value,
        drivingLicenceExpiresOn: driving.value,
        transportLicenceExpiresOn: transport.value,
        ...emailBody(email.value, linked),
        ...memberBody(memberUserId.value),
      },
    }))
    name.value = ''
    kind.value = undefined
    phone.value = ''
    email.value = ''
    driving.value = ''
    transport.value = ''
    memberUserId.value = noAccount
    notifyAuditChanged()
    await loadDrivers()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
  }
  finally {
    pending.value = false
  }
}

function openEdit(driver: Driver) {
  editing.value = driver
  editName.value = driver.name
  editKind.value = driver.kind
  editPhone.value = driver.phone
  editEmail.value = driver.email ?? ''
  editDriving.value = driver.drivingLicenceExpiresOn
  editTransport.value = driver.transportLicenceExpiresOn
  editMemberUserId.value = driver.memberUserId ?? noAccount
  editMustAccept.value = driver.mustAccept
  editNameErrorKey.value = null
  editKindErrorKey.value = null
  editPhoneErrorKey.value = null
  editEmailErrorKey.value = null
  editDrivingErrorKey.value = null
  editTransportErrorKey.value = null
  editErrorKey.value = null
}

async function saveEdit() {
  const current = editing.value
  const chosen = editKind.value
  const linked = editMemberUserId.value !== noAccount
  if (!current)
    return
  editNameErrorKey.value = nameKey(editName.value)
  editPhoneErrorKey.value = phoneKey(editPhone.value)
  editEmailErrorKey.value = linked ? null : emailKey(editEmail.value)
  editKindErrorKey.value = driverKindError(chosen ?? '') ? 'drivers.kindInvalid' : null
  editDrivingErrorKey.value = driverDateError(editDriving.value) ? 'drivers.dateInvalid' : null
  editTransportErrorKey.value = driverDateError(editTransport.value) ? 'drivers.dateInvalid' : null
  editErrorKey.value = null
  if (editNameErrorKey.value || editPhoneErrorKey.value || editEmailErrorKey.value || editKindErrorKey.value || editDrivingErrorKey.value || editTransportErrorKey.value || chosen === undefined)
    return
  saving.value = true
  try {
    const memberChanged = (current.memberUserId ?? noAccount) !== editMemberUserId.value
    const trimmedEmail = editEmail.value.trim()
    const emailChanged = trimmedEmail !== (current.email ?? '')
    driverSchema.parse(await $fetch(`/api/drivers/${current.id}`, {
      method: 'PATCH',
      body: {
        name: editName.value,
        kind: chosen,
        phone: editPhone.value,
        drivingLicenceExpiresOn: editDriving.value,
        transportLicenceExpiresOn: editTransport.value,
        // An unchanged link is omitted, so a member who has since left does not block a name correction.
        ...(memberChanged
          ? { memberUserId: editMemberUserId.value === noAccount ? null : editMemberUserId.value }
          : {}),
        // A linked Driver keeps the sign-in email. The office edits the address only after the link is gone.
        ...(!linked && emailChanged ? { email: trimmedEmail === '' ? null : trimmedEmail } : {}),
        // Starts off. Only an admin may turn it on or off, so a dispatcher omits it.
        ...(props.isAdmin ? { mustAccept: editMustAccept.value } : {}),
      },
    }))
    editing.value = null
    notifyAuditChanged()
    await loadDrivers()
  }
  catch (error) {
    editErrorKey.value = failureKey(error)
  }
  finally {
    saving.value = false
  }
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}

onMounted(() => {
  void loadDrivers()
  void loadMembers()
})
</script>

<template>
  <section>
    <h2
      :id="titleId"
      class="mb-4 text-xl font-semibold"
    >
      {{ t('drivers.add') }}
    </h2>
    <UAlert
      v-if="formErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      class="mb-4"
      :description="t(formErrorKey)"
    />
    <form
      novalidate
      @submit.prevent="addDriver"
    >
      <UFormField
        :label="t('drivers.name')"
        name="name"
        class="mb-4"
        size="xl"
        :error="nameErrorKey ? t(nameErrorKey) : false"
      >
        <UInput
          id="driver-name"
          v-model="name"
          name="name"
          type="text"
          autocomplete="off"
          class="w-full"
          @update:model-value="nameErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('drivers.kind')"
        name="kind"
        class="mb-4"
        size="xl"
        :error="kindErrorKey ? t(kindErrorKey) : false"
      >
        <USelect
          id="driver-kind"
          v-model="kind"
          name="kind"
          :items="kindItems"
          :placeholder="t('drivers.chooseKind')"
          class="w-full"
          @update:model-value="kindErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('drivers.phone')"
        name="phone"
        class="mb-4"
        size="xl"
        :error="phoneErrorKey ? t(phoneErrorKey) : false"
      >
        <UInput
          id="driver-phone"
          v-model="phone"
          name="phone"
          type="tel"
          autocomplete="off"
          class="w-full"
          @update:model-value="phoneErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        v-if="memberUserId === noAccount"
        :label="t('drivers.email')"
        name="email"
        class="mb-4"
        size="xl"
        :error="emailErrorKey ? t(emailErrorKey) : false"
      >
        <UInput
          id="driver-email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="off"
          class="w-full"
          @update:model-value="emailErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('drivers.drivingLicenceExpiresOn')"
        name="driving"
        class="mb-4"
        size="xl"
        :error="drivingErrorKey ? t(drivingErrorKey) : false"
      >
        <UInput
          id="driver-driving"
          v-model="driving"
          name="driving"
          type="date"
          autocomplete="off"
          class="w-full"
          @update:model-value="drivingErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('drivers.transportLicenceExpiresOn')"
        name="transport"
        class="mb-4"
        size="xl"
        :error="transportErrorKey ? t(transportErrorKey) : false"
      >
        <UInput
          id="driver-transport"
          v-model="transport"
          name="transport"
          type="date"
          autocomplete="off"
          class="w-full"
          @update:model-value="transportErrorKey = null"
        />
        <template #error="{ error }">
          <span role="alert">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        :label="t('drivers.member')"
        name="member"
        class="mb-4"
        size="xl"
      >
        <USelect
          id="driver-member"
          v-model="memberUserId"
          name="member"
          :items="memberItems"
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :disabled="pending"
      >
        {{ pending ? t('drivers.submitting') : t('drivers.submit') }}
      </UButton>
    </form>

    <h2
      :id="listTitleId"
      class="mt-8 mb-4 text-xl font-semibold"
    >
      {{ t('drivers.title') }}
    </h2>
    <UAlert
      v-if="loadErrorKey"
      color="error"
      variant="subtle"
      role="alert"
      :description="t(loadErrorKey)"
    />
    <p
      v-else-if="loading"
      role="status"
    >
      {{ t('drivers.loading') }}
    </p>
    <p v-else-if="drivers.length === 0">
      {{ t('drivers.empty') }}
    </p>
    <div
      v-else
      class="overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      role="region"
      :aria-labelledby="listTitleId"
      tabindex="0"
    >
      <UTable
        :data="drivers"
        :columns="columns"
        class="whitespace-nowrap"
      >
        <template #kind-cell="{ row }">
          {{ t(`drivers.kinds.${row.original.kind}`) }}
        </template>
        <template #driving-cell="{ row }">
          {{ formatDay(row.original.drivingLicenceExpiresOn) }}
        </template>
        <template #transport-cell="{ row }">
          {{ formatDay(row.original.transportLicenceExpiresOn) }}
        </template>
        <template #member-cell="{ row }">
          {{ memberLabel(row.original.memberUserId) }}
        </template>
        <template #mustAccept-cell="{ row }">
          {{ row.original.mustAccept ? t('drivers.yes') : t('drivers.no') }}
        </template>
        <template #actions-cell="{ row }">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            :aria-label="`${t('drivers.edit')}: ${row.original.name}`"
            @click="openEdit(row.original)"
          >
            {{ t('drivers.edit') }}
          </UButton>
        </template>
      </UTable>
    </div>

    <UModal
      v-model:open="editOpen"
      :title="t('drivers.edit')"
      :dismissible="!saving"
      :ui="{ footer: 'flex-col sm:flex-row sm:justify-end' }"
    >
      <template #body>
        <UAlert
          v-if="editErrorKey"
          color="error"
          variant="subtle"
          role="alert"
          class="mb-4"
          :description="t(editErrorKey)"
        />
        <form
          id="driver-edit"
          novalidate
          @submit.prevent="saveEdit"
        >
          <UFormField
            :label="t('drivers.name')"
            name="edit-name"
            class="mb-4"
            size="xl"
            :error="editNameErrorKey ? t(editNameErrorKey) : false"
          >
            <UInput
              id="driver-edit-name"
              v-model="editName"
              name="edit-name"
              type="text"
              autocomplete="off"
              class="w-full"
              @update:model-value="editNameErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('drivers.kind')"
            name="edit-kind"
            class="mb-4"
            size="xl"
            :error="editKindErrorKey ? t(editKindErrorKey) : false"
          >
            <USelect
              id="driver-edit-kind"
              v-model="editKind"
              name="edit-kind"
              :items="kindItems"
              class="w-full"
              @update:model-value="editKindErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('drivers.phone')"
            name="edit-phone"
            class="mb-4"
            size="xl"
            :error="editPhoneErrorKey ? t(editPhoneErrorKey) : false"
          >
            <UInput
              id="driver-edit-phone"
              v-model="editPhone"
              name="edit-phone"
              type="tel"
              autocomplete="off"
              class="w-full"
              @update:model-value="editPhoneErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('drivers.email')"
            name="edit-email"
            class="mb-4"
            size="xl"
            :error="editEmailErrorKey ? t(editEmailErrorKey) : false"
          >
            <UInput
              id="driver-edit-email"
              v-model="editEmail"
              name="edit-email"
              type="email"
              autocomplete="off"
              class="w-full"
              :disabled="editMemberUserId !== noAccount"
              @update:model-value="editEmailErrorKey = null"
            />
            <p
              v-if="editMemberUserId !== noAccount"
              class="mt-1 text-sm text-muted"
            >
              {{ t('drivers.emailFromAccount') }}
            </p>
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('drivers.drivingLicenceExpiresOn')"
            name="edit-driving"
            class="mb-4"
            size="xl"
            :error="editDrivingErrorKey ? t(editDrivingErrorKey) : false"
          >
            <UInput
              id="driver-edit-driving"
              v-model="editDriving"
              name="edit-driving"
              type="date"
              autocomplete="off"
              class="w-full"
              @update:model-value="editDrivingErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('drivers.transportLicenceExpiresOn')"
            name="edit-transport"
            class="mb-4"
            size="xl"
            :error="editTransportErrorKey ? t(editTransportErrorKey) : false"
          >
            <UInput
              id="driver-edit-transport"
              v-model="editTransport"
              name="edit-transport"
              type="date"
              autocomplete="off"
              class="w-full"
              @update:model-value="editTransportErrorKey = null"
            />
            <template #error="{ error }">
              <span role="alert">{{ error }}</span>
            </template>
          </UFormField>
          <UFormField
            :label="t('drivers.member')"
            name="edit-member"
            class="mb-4"
            size="xl"
          >
            <USelect
              id="driver-edit-member"
              v-model="editMemberUserId"
              name="edit-member"
              :items="memberItems"
              class="w-full"
            />
          </UFormField>
          <UCheckbox
            v-if="isAdmin"
            id="driver-edit-must-accept"
            v-model="editMustAccept"
            name="edit-must-accept"
            size="xl"
            :label="t('drivers.mustAccept')"
          />
        </form>
      </template>
      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :disabled="saving"
          @click="editing = null"
        >
          {{ t('drivers.cancel') }}
        </UButton>
        <UButton
          type="button"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="saving"
          @click="saveEdit"
        >
          {{ saving ? t('drivers.saving') : t('drivers.save') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
