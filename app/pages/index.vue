<script setup lang="ts">
import { calendarDateInTimeZone, formatCalendarDate, signInErrorKey } from '../../shared'

// Layout only. A Driver stays on the phone layout. Office staff get the
// dashboard layout. Sign-in, the Tenant gate, no-access, and the firm list
// stay on this page.
definePageMeta({
  middleware: 'authenticated',
})

const email = ref('')
const password = ref('')
const formError = ref<'signIn.failed' | 'signIn.limited' | null>(null)
const route = useRoute()
const passwordChanged = computed(() => route.query.passwordChanged === '1')

const {
  t,
  setLocale,
  session,
  loadError,
  refresh,
  pending,
  shellError,
  signOut,
  chooseLocale,
  loadMessage,
  platformRedirect,
  tenantChoices,
} = await useSessionShell()

const choiceError = ref(false)
const choosing = ref(false)

// The middleware runs on navigation. Sign-in and sign-out on Home stay on
// this URL, so the layout has to follow the shell after those actions too.
watch(session, (next) => {
  setPageLayout(isOfficeMember(next?.role) ? 'dashboard' : 'default')
})

// Nuxt 4.6 typechecks the template against script bindings. The auto-import
// alone is not one, so the class reads this computed.
const office = computed(() => isOfficeMember(session.value?.role))

const documents = ref<{ reload: () => Promise<void> } | null>(null)

function refreshDocuments() {
  return documents.value?.reload() ?? Promise.resolve()
}

/** The Driver header names today in the Tenant zone (ADR-0038). */
const driverToday = computed(() => {
  const current = session.value
  if (!current)
    return null
  const iso = calendarDateInTimeZone(current.timeZone, new Date())
  return { iso, label: formatCalendarDate(iso, current.locale) }
})

useHead({
  title: () => {
    if (session.value)
      return session.value.tenantName
    if (tenantChoices.value)
      return t('tenantGate.title')
    return t('signIn.title')
  },
})

// Office Home's h1 is the navbar title. A Driver keeps the name in the page.
bindScreenTitle(() => isOfficeMember(session.value?.role) ? t('shell.home') : '')

async function chooseTenant(tenantId: string) {
  choiceError.value = false
  choosing.value = true
  try {
    await $fetch('/api/tenant-choices', {
      method: 'POST',
      body: { tenantId },
    })
    await refresh()
    if (!session.value) {
      choiceError.value = true
      return
    }
    await setLocale(session.value.locale)
  }
  catch {
    choiceError.value = true
  }
  finally {
    choosing.value = false
  }
}

async function signIn() {
  formError.value = null
  pending.value = true
  try {
    await $fetch('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
    password.value = ''
    await refresh()
    if (platformRedirect.value || tenantChoices.value)
      return
    if (!session.value) {
      formError.value = 'signIn.failed'
      return
    }
    await setLocale(session.value.locale)
  }
  catch (error) {
    formError.value = signInErrorKey(httpStatus(error) ?? 0)
  }
  finally {
    pending.value = false
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
</script>

<template>
  <!--
    Signed out: the shared auth frame (ADR-0038). Office staff fill the
    dashboard panel. Driver Home stays at most 28rem (ADR-0016).
  -->
  <AuthFrame
    v-if="!loadError && !session"
    @choose="chooseLocale"
  >
    <div v-if="tenantChoices">
      <TenantGate
        :choices="tenantChoices"
        :pending="choosing || pending"
        @choose="chooseTenant"
      />
      <UButton
        type="button"
        size="xl"
        block
        class="mt-4"
        :disabled="choosing || pending"
        @click="signOut"
      >
        {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
      </UButton>
      <UAlert
        v-if="choiceError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t('tenantGate.failed')"
        :ui="{ description: 'text-sm text-default opacity-100' }"
      />
    </div>
    <form
      v-else
      @submit.prevent="signIn"
    >
      <UAlert
        v-if="passwordChanged"
        color="success"
        variant="subtle"
        role="status"
        class="mb-4"
        :description="t('signIn.passwordChanged')"
        :ui="{ description: 'text-sm text-default opacity-100' }"
      />
      <UFormField
        :label="t('signIn.email')"
        name="email"
        class="mb-4"
        size="xl"
      >
        <UInput
          id="email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField
        :label="t('signIn.password')"
        name="password"
        class="mb-4"
        size="xl"
      >
        <UInput
          id="password"
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          class="w-full"
        />
      </UFormField>
      <p class="mb-4">
        <NuxtLink
          to="/forgot-password"
          class="inline-flex min-h-11 items-center text-sm text-default underline underline-offset-2"
        >
          {{ t('signIn.forgot') }}
        </NuxtLink>
      </p>
      <UButton
        type="submit"
        size="xl"
        block
        :disabled="pending"
      >
        {{ pending ? t('signIn.submitting') : t('signIn.submit') }}
      </UButton>
    </form>
    <!-- The failure stays under the button. Typed values are kept. -->
    <!--
      The error variant's text is red on a red wash, under 4.5:1 in light.
      Body text at full opacity keeps the alert and passes the contrast rule.
    -->
    <UAlert
      v-if="formError"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :description="t(formError)"
      :ui="{ description: 'text-sm text-default opacity-100' }"
    />
  </AuthFrame>
  <main
    v-else
    class="box-border w-full p-4"
    :class="office ? undefined : 'mx-auto max-w-md'"
  >
    <section v-if="loadError">
      <UAlert
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(loadMessage)"
      />
      <UButton
        type="button"
        size="xl"
        :disabled="pending"
        @click="signOut"
      >
        {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
      </UButton>
    </section>

    <section v-else-if="session">
      <!--
        The Driver header is the Tenant name, today's date, and the profile
        menu. The large Profile and sign-out buttons left this list.
      -->
      <div
        v-if="session.role === 'driver'"
        class="mb-4 flex items-start justify-between gap-3"
      >
        <div>
          <p class="text-sm text-muted">
            {{ t('shell.tenant') }}
          </p>
          <h1 class="text-2xl font-semibold">
            {{ session.tenantName }}
          </h1>
          <time
            v-if="driverToday"
            class="text-sm text-muted tabular-nums"
            :datetime="driverToday.iso"
          >
            {{ driverToday.label }}
          </time>
        </div>
        <OfficeUserMenu :show-tenant-on-trigger="false" />
      </div>
      <!--
        One notice row, and only when a document expires. It sits above the
        next Ride (ADR-0038). The list refresh reloads it.
      -->
      <ExpiringDocuments
        v-if="session.role === 'driver'"
        ref="documents"
        variant="notice"
      />
      <DriverRides
        v-if="session.role === 'driver'"
        :time-zone="session.timeZone"
        :locale="session.locale"
        :refresh-documents="refreshDocuments"
      />
      <!--
        Office Home is the balance, Pozornost, and the three lists. The
        frame owns the office-home read. Documents sit in the right column.
        Locale and theme stay on Profile.
      -->
      <OfficeHome
        v-else
        :time-zone="session.timeZone"
        :locale="session.locale"
        :refresh-documents="refreshDocuments"
      >
        <template #documents>
          <ExpiringDocuments
            ref="documents"
            :show-refresh="false"
          />
        </template>
      </OfficeHome>
      <!--
        Tenant settings, Members, invitations, and the audit log live on
        their own screens.
      -->
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
    </section>
  </main>
</template>
