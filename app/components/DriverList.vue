<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Driver, DriverKind } from '../../shared'
import { z } from 'zod'
import { catalogSearchMatches, DRIVER_KINDS, driverDateError, driverEmailError, driverListSchema, driverNameError, driverPhoneError, driverSchema, memberListSchema } from '../../shared'
import { commandControlClass, commandControlSize, commandInputClass } from '../ride-detail'

const props = defineProps<{
  isAdmin: boolean
}>()

const { t, locale } = useI18n()
const { notifyAuditChanged } = useAuditRefresh()
const listTitleId = useId()
const searchId = useId()
const query = ref('')

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
const saving = ref(false)

/**
 * Add and correct share one panel. A Driver has no archive:
 * there is no archive route, so the row has no ⋮.
 */
const formMode = ref<'add' | 'edit' | null>(null)
const editingId = ref<string | null>(null)
/** The panel title stays the name that was opened, not the half-typed correction. */
const openedName = ref('')
const linkedOnOpen = ref(noAccount)
const emailOnOpen = ref('')
const state = reactive<{
  name: string
  kind?: DriverKind
  phone: string
  email: string
  drivingLicenceExpiresOn: string
  transportLicenceExpiresOn: string
  memberUserId: string
  mustAccept: boolean
}>({
  name: '',
  phone: '',
  email: '',
  drivingLicenceExpiresOn: '',
  transportLicenceExpiresOn: '',
  memberUserId: noAccount,
  mustAccept: false,
})

type DriverFailure = 'drivers.loadFailed' | 'drivers.rejected' | 'drivers.notFound' | 'drivers.forbidden' | 'drivers.signedOut' | 'drivers.saveFailed'
interface DriverForm {
  name: string
  kind: DriverKind
  phone: string
  email: string
  drivingLicenceExpiresOn: string
  transportLicenceExpiresOn: string
  memberUserId: string
  mustAccept: boolean
}

const kindItems = computed(() => [
  { label: t('drivers.kinds.own'), value: 'own' as const },
  { label: t('drivers.kinds.external'), value: 'external' as const },
])

const memberItems = computed(() => [
  { label: t('drivers.noAccount'), value: noAccount },
  ...members.value.map(member => ({ label: member.name, value: member.userId })),
])

const phoneColumn = { class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }
const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('drivers.name') },
  { id: 'kind', header: t('drivers.kind'), meta: phoneColumn },
  { accessorKey: 'phone' as const, header: t('drivers.phone'), meta: phoneColumn },
  { accessorKey: 'email' as const, header: t('drivers.email'), meta: phoneColumn },
  { id: 'driving', header: t('drivers.drivingLicenceExpiresOn'), meta: phoneColumn },
  { id: 'transport', header: t('drivers.transportLicenceExpiresOn'), meta: phoneColumn },
  { id: 'member', header: t('drivers.member'), meta: phoneColumn },
  { id: 'mustAccept', header: t('drivers.mustAccept'), meta: phoneColumn },
])

const visibleDrivers = computed(() => drivers.value.filter(driver =>
  catalogSearchMatches(query.value, [
    driver.name,
    t(`drivers.kinds.${driver.kind}`),
    driver.phone,
    driver.email ?? '',
    formatDay(driver.drivingLicenceExpiresOn),
    formatDay(driver.transportLicenceExpiresOn),
    memberLabel(driver.memberUserId),
  ]),
))

/** Messages follow the active Locale. A linked Driver does not type an address. */
const schema = computed(() => z.object({
  name: z.string().superRefine((value, ctx) => {
    const problem = driverNameError(value)
    if (problem === 'empty')
      ctx.addIssue({ code: 'custom', message: t('drivers.nameEmpty') })
    else if (problem === 'too-long')
      ctx.addIssue({ code: 'custom', message: t('drivers.nameTooLong') })
  }),
  kind: z.enum(DRIVER_KINDS, { error: t('drivers.kindInvalid') }),
  phone: z.string().superRefine((value, ctx) => {
    const problem = driverPhoneError(value)
    if (problem === 'empty')
      ctx.addIssue({ code: 'custom', message: t('drivers.phoneEmpty') })
    else if (problem === 'too-long')
      ctx.addIssue({ code: 'custom', message: t('drivers.phoneTooLong') })
  }),
  email: z.string(),
  drivingLicenceExpiresOn: z.string().superRefine((value, ctx) => {
    if (driverDateError(value))
      ctx.addIssue({ code: 'custom', message: t('drivers.dateInvalid') })
  }),
  transportLicenceExpiresOn: z.string().superRefine((value, ctx) => {
    if (driverDateError(value))
      ctx.addIssue({ code: 'custom', message: t('drivers.dateInvalid') })
  }),
  memberUserId: z.string(),
  mustAccept: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.memberUserId !== noAccount)
    return
  if (driverEmailError(value.email)) {
    ctx.addIssue({
      code: 'custom',
      message: t('drivers.emailInvalid'),
      path: ['email'],
    })
  }
}))

const formOpen = computed({
  get: () => formMode.value !== null,
  set(open: boolean) {
    if (!open && !saving.value)
      formMode.value = null
  },
})

const formTitle = computed(() => formMode.value === 'edit' ? openedName.value : t('drivers.add'))
const submitLabel = computed(() => {
  if (saving.value)
    return formMode.value === 'edit' ? t('drivers.saving') : t('drivers.submitting')
  return formMode.value === 'edit' ? t('drivers.save') : t('drivers.submit')
})
const emailLocked = computed(() => state.memberUserId !== noAccount)

function failureKey(error: unknown): DriverFailure {
  switch (httpStatus(error)) {
    case 400: return 'drivers.rejected'
    case 401: return 'drivers.signedOut'
    case 403: return 'drivers.forbidden'
    case 404: return 'drivers.notFound'
    default: return 'drivers.saveFailed'
  }
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

function driverSecondLine(driver: Driver): string {
  return `${t(`drivers.kinds.${driver.kind}`)} · ${formatDay(driver.drivingLicenceExpiresOn)}`
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

function resetForm() {
  state.name = ''
  state.kind = undefined
  state.phone = ''
  state.email = ''
  state.drivingLicenceExpiresOn = ''
  state.transportLicenceExpiresOn = ''
  state.memberUserId = noAccount
  state.mustAccept = false
  linkedOnOpen.value = noAccount
  emailOnOpen.value = ''
  openedName.value = ''
  formErrorKey.value = null
}

function openAdd() {
  editingId.value = null
  resetForm()
  formMode.value = 'add'
}

function openEdit(driver: Driver) {
  editingId.value = driver.id
  openedName.value = driver.name
  state.name = driver.name
  state.kind = driver.kind
  state.phone = driver.phone
  state.email = driver.email ?? ''
  state.drivingLicenceExpiresOn = driver.drivingLicenceExpiresOn
  state.transportLicenceExpiresOn = driver.transportLicenceExpiresOn
  state.memberUserId = driver.memberUserId ?? noAccount
  state.mustAccept = driver.mustAccept
  linkedOnOpen.value = driver.memberUserId ?? noAccount
  emailOnOpen.value = driver.email ?? ''
  formErrorKey.value = null
  formMode.value = 'edit'
}

async function onSubmit(event: FormSubmitEvent<DriverForm>) {
  formErrorKey.value = null
  saving.value = true
  try {
    const linked = event.data.memberUserId !== noAccount
    if (formMode.value === 'edit') {
      const id = editingId.value
      if (!id)
        return
      const memberChanged = linkedOnOpen.value !== event.data.memberUserId
      const trimmedEmail = event.data.email.trim()
      const emailChanged = trimmedEmail !== emailOnOpen.value
      driverSchema.parse(await $fetch(`/api/drivers/${id}`, {
        method: 'PATCH',
        body: {
          name: event.data.name,
          kind: event.data.kind,
          phone: event.data.phone,
          drivingLicenceExpiresOn: event.data.drivingLicenceExpiresOn,
          transportLicenceExpiresOn: event.data.transportLicenceExpiresOn,
          // An unchanged link is omitted, so a member who has since left does not block a name correction.
          ...(memberChanged
            ? { memberUserId: event.data.memberUserId === noAccount ? null : event.data.memberUserId }
            : {}),
          // A linked Driver keeps the sign-in email. The office edits the address only after the link is gone.
          ...(!linked && emailChanged ? { email: trimmedEmail === '' ? null : trimmedEmail } : {}),
          // Starts off. Only an admin may turn it on or off, so a dispatcher omits it.
          ...(props.isAdmin ? { mustAccept: event.data.mustAccept } : {}),
        },
      }))
    }
    else {
      driverSchema.parse(await $fetch('/api/drivers', {
        method: 'POST',
        body: {
          name: event.data.name,
          kind: event.data.kind,
          phone: event.data.phone,
          drivingLicenceExpiresOn: event.data.drivingLicenceExpiresOn,
          transportLicenceExpiresOn: event.data.transportLicenceExpiresOn,
          ...emailBody(event.data.email, linked),
          ...memberBody(event.data.memberUserId),
        },
      }))
    }
    formMode.value = null
    notifyAuditChanged()
    await loadDrivers()
  }
  catch (error) {
    formErrorKey.value = failureKey(error)
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
  <CatalogPanel
    v-model:open="formOpen"
    :title="formTitle"
    :dismissible="!saving"
  >
    <template #toolbar>
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <div class="min-w-48 flex-1">
          <!-- UFormField outside a UForm does not label the input. Axe and the searchbox name need for/id. -->
          <label
            :for="searchId"
            class="mb-1 block text-sm font-medium max-lg:text-base"
          >{{ t('catalog.search') }}</label>
          <UInput
            :id="searchId"
            v-model="query"
            type="search"
            autocomplete="off"
            class="w-full"
            :class="commandInputClass"
          />
        </div>
        <UButton
          type="button"
          class="h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base"
          @click="openAdd"
        >
          {{ t('catalog.add') }}
        </UButton>
      </div>
    </template>

    <template #list>
      <h2
        :id="listTitleId"
        class="mb-4 text-xl font-semibold"
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
      <div
        v-else
        class="focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary lg:overflow-x-auto"
        role="region"
        :aria-labelledby="listTitleId"
        tabindex="0"
      >
        <UTable
          :data="visibleDrivers"
          :columns="columns"
          :loading="loading"
          class="lg:whitespace-nowrap"
          @select="(_event: Event, row: { original: Driver }) => openEdit(row.original)"
        >
          <template #name-cell="{ row }">
            <button
              type="button"
              class="block min-h-7 w-full text-left font-medium max-lg:min-h-11 max-lg:text-base"
              @click="openEdit(row.original)"
            >
              {{ row.original.name }}
            </button>
            <p class="mt-0.5 text-sm text-muted lg:hidden">
              {{ driverSecondLine(row.original) }}
            </p>
          </template>
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
          <template #loading>
            <div
              role="status"
              class="space-y-2 py-2"
            >
              <p>{{ t('drivers.loading') }}</p>
              <USkeleton class="h-8 w-full" />
              <USkeleton class="h-8 w-full" />
            </div>
          </template>
          <template #empty>
            <UEmpty
              :title="query.trim() ? t('catalog.searchEmpty') : t('drivers.empty')"
              icon="i-lucide-user"
              variant="naked"
            />
          </template>
        </UTable>
      </div>
    </template>

    <template #body="{ phone }">
      <UAlert
        v-if="formErrorKey"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(formErrorKey)"
      />
      <UForm
        id="driver-form"
        novalidate
        :schema="schema"
        :state="state"
        :validate-on="[]"
        class="space-y-4"
        :class="commandInputClass"
        @submit="onSubmit"
        @error="formErrorKey = null"
      >
        <UFormField
          :label="t('drivers.name')"
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
          :label="t('drivers.kind')"
          name="kind"
          :size="phone ? 'xl' : 'sm'"
        >
          <USelect
            v-model="state.kind"
            name="kind"
            :items="kindItems"
            :placeholder="t('drivers.chooseKind')"
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
          :label="t('drivers.phone')"
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
          v-if="formMode === 'edit' || !emailLocked"
          :label="t('drivers.email')"
          name="email"
          :size="phone ? 'xl' : 'sm'"
        >
          <UInput
            v-model="state.email"
            name="email"
            type="email"
            autocomplete="off"
            class="w-full"
            :disabled="emailLocked"
          />
          <p
            v-if="emailLocked"
            class="mt-1 text-sm text-muted"
          >
            {{ t('drivers.emailFromAccount') }}
          </p>
          <template #error="{ error }">
            <span
              v-if="error"
              role="alert"
            >{{ error }}</span>
          </template>
        </UFormField>
        <UFormField
          :label="t('drivers.drivingLicenceExpiresOn')"
          name="drivingLicenceExpiresOn"
          :size="phone ? 'xl' : 'sm'"
        >
          <UInput
            v-model="state.drivingLicenceExpiresOn"
            name="drivingLicenceExpiresOn"
            type="date"
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
          :label="t('drivers.transportLicenceExpiresOn')"
          name="transportLicenceExpiresOn"
          :size="phone ? 'xl' : 'sm'"
        >
          <UInput
            v-model="state.transportLicenceExpiresOn"
            name="transportLicenceExpiresOn"
            type="date"
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
          :label="t('drivers.member')"
          name="memberUserId"
          :size="phone ? 'xl' : 'sm'"
        >
          <USelect
            v-model="state.memberUserId"
            name="memberUserId"
            :items="memberItems"
            class="w-full"
          />
        </UFormField>
        <UCheckbox
          v-if="formMode === 'edit' && isAdmin"
          v-model="state.mustAccept"
          name="must-accept"
          :size="phone ? 'xl' : 'sm'"
          :label="t('drivers.mustAccept')"
        />
      </UForm>
    </template>
    <template #footer="{ phone }">
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :size="commandControlSize(phone)"
        class="w-full justify-center sm:w-auto"
        :class="commandControlClass(phone)"
        :disabled="saving"
        @click="formOpen = false"
      >
        {{ t('drivers.cancel') }}
      </UButton>
      <UButton
        type="submit"
        form="driver-form"
        :size="commandControlSize(phone)"
        class="w-full justify-center sm:w-auto"
        :class="commandControlClass(phone)"
        :loading="saving"
      >
        {{ submitLabel }}
      </UButton>
    </template>
  </CatalogPanel>
</template>
