<script setup lang="ts">
import { companyAccountSchema, formatInstant } from '../../../../shared'

definePageMeta({
  middleware: 'platform-auth',
  layout: 'platform',
})

const requestFetch = useRequestFetch()
const route = useRoute()
const { t, locale, shell, loadError, pending, shellError, signOut, loadMessage } = await usePlatformPage()

const name = ref('')
const formError = ref<'platform.nameInvalid' | 'platform.saveFailed' | 'platform.notFound' | null>(null)
const saved = ref(false)
const saving = ref(false)

const { data: account, refresh } = await useAsyncData('platform-account', async () => {
  if (!shell.value)
    return null
  return companyAccountSchema.parse(await requestFetch<unknown>(`/api/platform/tenants/${String(route.params.id)}`))
})

watch(account, (value) => {
  if (value)
    name.value = value.name
}, { immediate: true })

// Same rule as the firm list: no platform shell, no platform title.
bindScreenTitle(() => shell.value ? (account.value?.name ?? t('platform.title')) : '')

useHead({
  title: () => shell.value ? (account.value?.name ?? t('platform.title')) : '',
})

async function rename() {
  formError.value = null
  saved.value = false
  saving.value = true
  try {
    const updated = companyAccountSchema.parse(await $fetch<unknown>(`/api/platform/tenants/${String(route.params.id)}`, {
      method: 'PATCH',
      body: { name: name.value },
    }))
    name.value = updated.name
    saved.value = true
    await refresh()
  }
  catch (error) {
    const status = httpStatus(error)
    if (status === 400)
      formError.value = 'platform.nameInvalid'
    else if (status === 404)
      formError.value = 'platform.notFound'
    else
      formError.value = 'platform.saveFailed'
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
</script>

<template>
  <main class="box-border w-full p-4">
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

    <section v-else-if="shell && account">
      <dl class="mb-4 grid gap-2 text-sm">
        <div>
          <dt class="text-muted">
            {{ t('platform.slug') }}
          </dt>
          <dd>{{ account.slug }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            {{ t('platform.created') }}
          </dt>
          <dd>
            <time :datetime="account.createdAt">
              {{ formatInstant(new Date(account.createdAt), shell.timeZone, locale === 'en' ? 'en' : 'hr') }}
            </time>
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            {{ t('platform.active') }}
          </dt>
          <dd>{{ account.active ? t('platform.activeYes') : t('platform.activeNo') }}</dd>
        </div>
      </dl>
      <UAlert
        v-if="formError"
        color="error"
        variant="subtle"
        role="alert"
        class="mb-4"
        :description="t(formError)"
      />
      <UAlert
        v-else-if="saved"
        color="success"
        variant="subtle"
        role="status"
        class="mb-4"
        :description="t('platform.renamed')"
      />
      <form @submit.prevent="rename">
        <UFormField
          :label="t('platform.name')"
          name="name"
          class="mb-4"
          size="xl"
        >
          <UInput
            id="platform-tenant-name"
            v-model="name"
            name="name"
            type="text"
            autocomplete="off"
            class="w-full"
            @update:model-value="formError = null"
          />
        </UFormField>
        <UButton
          type="submit"
          size="xl"
          :loading="saving"
        >
          {{ t('platform.rename') }}
        </UButton>
      </form>
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
