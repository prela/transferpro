<script setup lang="ts">
import { companyAccountListSchema, parsePlatformTenantListQuery } from '../../../../shared'

definePageMeta({
  middleware: 'platform-auth',
  layout: 'platform',
})

const requestFetch = useRequestFetch()
const route = useRoute()
const { t, shell, loadError, pending, shellError, signOut, loadMessage } = await usePlatformPage()

// The navbar title is the screen's h1. A 403 is not the firm list, so the
// denial screen must not say Tvrtke.
bindScreenTitle(() => shell.value ? t('platform.title') : '')

const search = ref('')

/**
 * One page and an optional name or slug. A bad query is not fetched:
 * the error would otherwise be the only thing on a screen that must paint.
 */
const parsedQuery = computed(() => {
  const page = route.query.page
  const q = route.query.q
  const raw: { page?: string, q?: string } = {}
  if (typeof page === 'string')
    raw.page = page
  else if (page !== undefined)
    return null
  if (typeof q === 'string')
    raw.q = q
  else if (q !== undefined)
    return null
  try {
    return parsePlatformTenantListQuery(raw)
  }
  catch {
    return null
  }
})

watch(parsedQuery, (value) => {
  if (value)
    search.value = value.q
}, { immediate: true })

/** Page 1 omits `page`. An empty search omits `q`. */
function listQuery(page: number, q: string): Record<string, string> {
  const query: Record<string, string> = {}
  if (q)
    query.q = q
  if (page > 1)
    query.page = String(page)
  return query
}

const { data: list } = await useAsyncData(
  () => `platform-tenants:${parsedQuery.value?.q ?? ''}:${parsedQuery.value?.page ?? ''}`,
  async () => {
    const query = parsedQuery.value
    if (!shell.value || query === null)
      return null
    const params = new URLSearchParams(listQuery(query.page, query.q))
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return companyAccountListSchema.parse(await requestFetch<unknown>(`/api/platform/tenants${suffix}`))
  },
)

const pageCount = computed(() => {
  const current = list.value
  if (!current || current.total === 0)
    return 1
  return Math.ceil(current.total / current.pageSize)
})

function pageTo(page: number) {
  return { path: '/admin/tenants', query: listQuery(page, parsedQuery.value?.q ?? '') }
}

async function submitSearch() {
  await navigateTo({
    path: '/admin/tenants',
    query: listQuery(1, search.value.trim()),
  })
}

useHead({
  title: () => shell.value ? t('platform.title') : '',
})
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

    <section v-else-if="shell && parsedQuery === null">
      <UAlert
        color="error"
        variant="subtle"
        role="alert"
        :description="t('platform.queryInvalid')"
      />
    </section>

    <section v-else-if="shell && list">
      <form
        class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        @submit.prevent="submitSearch"
      >
        <UFormField
          :label="t('platform.search')"
          name="q"
          class="min-w-0 flex-1"
          size="xl"
        >
          <UInput
            id="platform-tenant-search"
            v-model="search"
            name="q"
            type="search"
            autocomplete="off"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          size="xl"
        >
          {{ t('platform.searchSubmit') }}
        </UButton>
      </form>
      <p
        v-if="list.accounts.length === 0"
        class="text-sm text-muted"
      >
        {{ list.total === 0 && !parsedQuery?.q ? t('platform.empty') : t('platform.noMatches') }}
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
      <nav
        v-if="list.total > list.pageSize"
        class="mt-4 flex flex-wrap items-center gap-2"
        :aria-label="t('platform.pages')"
      >
        <UButton
          v-if="list.page > 1"
          :to="pageTo(list.page - 1)"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('platform.previous') }}
        </UButton>
        <p class="text-sm text-muted">
          {{ t('platform.page', { page: list.page, pages: pageCount }) }}
        </p>
        <UButton
          v-if="list.page * list.pageSize < list.total"
          :to="pageTo(list.page + 1)"
          color="neutral"
          variant="outline"
          size="xl"
        >
          {{ t('platform.next') }}
        </UButton>
      </nav>
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
