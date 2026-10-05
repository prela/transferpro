<script setup lang="ts">
import { companyAccountListSchema } from '../../../../shared'

const requestFetch = useRequestFetch()
const { t, shell, loadError, pending, shellError, signOut, chooseLocale, loadMessage } = await usePlatformPage()

const { data: list } = await useAsyncData('platform-tenants', async () => {
  if (!shell.value)
    return null
  return companyAccountListSchema.parse(await requestFetch<unknown>('/api/platform/tenants'))
})

useHead({
  title: () => t('platform.title'),
})
</script>

<template>
  <main class="mx-auto box-border w-full max-w-3xl p-4">
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

    <section v-else-if="shell && list">
      <h1 class="mb-4 text-2xl font-semibold">
        {{ t('platform.title') }}
      </h1>
      <p
        v-if="list.accounts.length === 0"
        class="text-sm text-muted"
      >
        {{ t('platform.empty') }}
      </p>
      <ul
        v-else
        class="flex flex-col gap-2"
      >
        <li
          v-for="account in list.accounts"
          :key="account.id"
        >
          <UButton
            :to="`/admin/tenants/${account.id}`"
            color="neutral"
            variant="outline"
            size="xl"
            class="w-full justify-start"
          >
            {{ account.name }}
          </UButton>
        </li>
      </ul>
      <UAlert
        v-if="shellError"
        color="error"
        variant="subtle"
        role="alert"
        class="mt-4"
        :description="t(shellError)"
      />
      <div class="mt-4 flex flex-wrap gap-2">
        <UButton
          type="button"
          size="xl"
          class="flex-1 basis-32 justify-center"
          :disabled="pending"
          @click="signOut"
        >
          {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
        </UButton>
        <LocaleThemeActions @choose="chooseLocale" />
      </div>
    </section>
  </main>
</template>
