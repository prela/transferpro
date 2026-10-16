<script setup lang="ts">
import type { RideDetailLayout } from '../ride-detail'
import { rideDetailLayout } from '../ride-detail'

const props = defineProps<{
  title: string
  /** A save in flight must not drop the typed fields. */
  dismissible?: boolean
}>()

/**
 * The catalog detail uses the same three layouts as the Ride detail
 * (ADR-0038): beside the table from 1440 px, a 420 px overlay below that,
 * and a full-screen panel on the phone. The list stays mounted so a later
 * load does not throw away the search.
 */
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const layout = ref<RideDetailLayout>('overlay')
const layoutReady = ref(false)
const titleId = useId()

function close() {
  if (props.dismissible === false)
    return
  open.value = false
}

onMounted(() => {
  const phoneQuery = window.matchMedia('(max-width: 1023px)')
  const besideQuery = window.matchMedia('(min-width: 1440px)')
  const apply = () => {
    layout.value = rideDetailLayout(window.innerWidth)
  }
  apply()
  layoutReady.value = true
  phoneQuery.addEventListener('change', apply)
  besideQuery.addEventListener('change', apply)
  onScopeDispose(() => {
    phoneQuery.removeEventListener('change', apply)
    besideQuery.removeEventListener('change', apply)
  })
})
</script>

<template>
  <section>
    <slot name="toolbar" />
    <div class="flex items-start gap-4">
      <div class="min-w-0 flex-1">
        <slot name="list" />
      </div>
      <UDashboardPanel
        v-if="layoutReady && layout === 'beside' && open"
        :ui="{ root: '!min-h-0 !h-auto !w-[420px] !max-w-[420px] !flex-none shrink-0 border-s border-default' }"
      >
        <template #body>
          <div
            role="region"
            :aria-labelledby="titleId"
          >
            <header class="mb-4 flex items-start justify-between gap-2">
              <h2
                :id="titleId"
                class="text-lg font-semibold"
              >
                {{ title }}
              </h2>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-x"
                :aria-label="t('ride.detailClose')"
                :disabled="dismissible === false"
                @click="close"
              />
            </header>
            <slot
              name="body"
              :phone="false"
            />
            <footer class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <slot
                name="footer"
                :phone="false"
              />
            </footer>
          </div>
        </template>
      </UDashboardPanel>
    </div>

    <USlideover
      v-if="layoutReady && layout !== 'beside' && open"
      :open="true"
      :title="title"
      :dismissible="dismissible !== false"
      :overlay="false"
      :modal="layout === 'phone'"
      :ui="layout === 'phone'
        ? { content: 'pointer-events-auto z-[60] w-screen max-w-none', body: 'flex flex-col', footer: 'flex-col gap-2 p-3' }
        : { content: 'pointer-events-auto z-[60] w-[420px] max-w-[420px]', footer: 'flex-col gap-2 sm:flex-row sm:justify-end' }"
      @update:open="(value: boolean) => { if (!value) close() }"
    >
      <template #body>
        <slot
          name="body"
          :phone="layout === 'phone'"
        />
      </template>
      <template #footer>
        <slot
          name="footer"
          :phone="layout === 'phone'"
        />
      </template>
    </USlideover>
  </section>
</template>
