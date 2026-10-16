<script setup lang="ts">
import type { InputProps } from '@nuxt/ui'
import type { TransferSearchHit } from '../../shared'
import { formatCommandDay, parseCommandDay, TRANSFER_SEARCH_MAX_LENGTH, transferSearchSchema } from '../../shared'

/**
 * Office command palette (ADR-0038). Ctrl/Cmd+K on the desktop, the top-bar
 * magnifier on the phone. Theme stays in the profile menu, so the built-in
 * colour-mode group is off. A Dispatcher receives only the screens `officeNav`
 * already allows. The Transfer read is the one from #250; this does not log
 * the query.
 */
const props = defineProps<{
  links: { label: string, to: string, icon: string }[]
}>()

const open = defineModel<boolean>('open', { default: false })
const searchTerm = ref('')

const { t, locale } = useI18n()
const { requestNewTransfer } = useNewTransferRequest()

const hits = ref<TransferSearchHit[]>([])
const searching = ref(false)
const failed = ref(false)

/** A keystroke must not send the query. The read starts once typing pauses. */
const SEARCH_PAUSE_MS = 200

let ticket = 0
let timer: ReturnType<typeof setTimeout> | undefined
let inflight: AbortController | undefined

function displayLocale(): 'hr' | 'en' {
  return locale.value === 'en' ? 'en' : 'hr'
}

function stopSearch() {
  ticket += 1
  if (timer !== undefined)
    clearTimeout(timer)
  timer = undefined
  inflight?.abort()
  inflight = undefined
  searching.value = false
}

watch(open, (isOpen) => {
  if (!isOpen)
    searchTerm.value = ''
})

watch([open, searchTerm], () => {
  stopSearch()
  hits.value = []
  failed.value = false
  const query = searchTerm.value.trim()
  if (!open.value || query.length === 0 || query.length > TRANSFER_SEARCH_MAX_LENGTH)
    return
  const mine = ticket
  searching.value = true
  timer = setTimeout(() => {
    void loadSearch(mine, query)
  }, SEARCH_PAUSE_MS)
})

async function loadSearch(mine: number, query: string) {
  const controller = new AbortController()
  inflight = controller
  try {
    const body = transferSearchSchema.parse(await $fetch('/api/transfers/search', {
      query: { q: query },
      signal: controller.signal,
    }))
    if (mine !== ticket)
      return
    hits.value = body.results
  }
  catch {
    // The failure text has no query. An abort is the next keystroke, not a failure.
    if (mine !== ticket || controller.signal.aborted)
      return
    failed.value = true
  }
  finally {
    if (mine === ticket)
      searching.value = false
  }
}

onScopeDispose(stopSearch)

const day = computed(() => parseCommandDay(searchTerm.value))

/**
 * Nuxt UI's input prop type omits aria attributes. UInput still copies an
 * undeclared attribute onto the field, and that is the name axe reads.
 * The placeholder alone is not a label.
 */
const searchInput = computed(() => ({
  'aria-label': t('palette.placeholder'),
}) as InputProps)

const groups = computed(() => {
  const localeCode = displayLocale()
  const next: {
    id: string
    label: string
    ignoreFilter?: boolean
    items: Record<string, unknown>[]
  }[] = []
  if (props.links.length > 0) {
    next.push({
      id: 'screens',
      label: t('palette.screens'),
      items: props.links.map(link => ({
        label: link.label,
        icon: link.icon,
        to: link.to,
      })),
    })
  }
  // Filtered, so a guest name does not leave "Novi transfer" as the first row.
  // The resolved day is its own group: the typed date does not match the label.
  next.push({
    id: 'commands',
    label: t('palette.commands'),
    items: [
      {
        label: t('shell.newTransfer'),
        icon: 'i-lucide-plus',
        onSelect: () => {
          void requestNewTransfer()
        },
      },
      ...(day.value
        ? []
        : [{
            label: t('palette.goToDay'),
            icon: 'i-lucide-calendar',
            description: t('palette.goToDayHint'),
          }]),
    ],
  })
  if (day.value) {
    const iso = day.value
    next.push({
      id: 'day',
      label: t('palette.commands'),
      ignoreFilter: true,
      items: [{
        label: t('palette.goToDayOn', { date: formatCommandDay(iso, localeCode) }),
        icon: 'i-lucide-calendar',
        to: `/transfers?day=${iso}`,
      }],
    })
  }
  if (failed.value) {
    next.push({
      id: 'transfers',
      label: t('palette.transfers'),
      ignoreFilter: true,
      items: [{
        label: t('palette.searchFailed'),
        disabled: true,
      }],
    })
  }
  else if (hits.value.length > 0) {
    next.push({
      id: 'transfers',
      label: t('palette.transfers'),
      ignoreFilter: true,
      items: hits.value.map(hit => ({
        label: hit.guestName,
        description: t('palette.result', {
          day: formatCommandDay(hit.operationalDay, localeCode),
          start: hit.start,
          end: hit.end,
          client: hit.clientName,
        }),
        icon: 'i-lucide-route',
        to: `/transfers?day=${encodeURIComponent(hit.operationalDay)}&ride=${encodeURIComponent(hit.rideId)}`,
      })),
    })
  }
  return next
})
</script>

<template>
  <!--
    meta_k is Ctrl+K on Linux and Windows, and Cmd+K on macOS, including
    while a field is focused. Esc is the dialog's own dismiss.
  -->
  <UDashboardSearch
    v-model:open="open"
    v-model:search-term="searchTerm"
    :groups="groups"
    :color-mode="false"
    shortcut="meta_k"
    :loading="searching"
    :title="t('palette.title')"
    :description="t('palette.description')"
    :placeholder="t('palette.placeholder')"
    :input="searchInput"
    :preserve-group-order="true"
  />
</template>
