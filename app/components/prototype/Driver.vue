<script setup lang="ts">
import { DRIVER_NEXT_ID, DRIVER_RIDE_IDS, findRide } from '../../prototype/day'
import { money } from '../../prototype/present'

const { copy } = usePrototypeCopy()
const colorMode = useColorMode()
const { setLocale } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const nextRide = findRide(DRIVER_NEXT_ID)
const others = DRIVER_RIDE_IDS
  .filter(id => id !== DRIVER_NEXT_ID)
  .map(id => findRide(id))
  .filter(ride => ride !== null)
const openId = ref<string | null>(null)
const confirm = ref<'done' | 'decline' | 'no-show' | null>(null)
const tabla = computed(() => route.query.tabla === '1')

let wakeLock: { release: () => Promise<void> } | null = null

async function holdScreen(on: boolean) {
  if (!import.meta.client)
    return
  if (!on) {
    await wakeLock?.release().catch(() => {})
    wakeLock = null
    return
  }
  try {
    wakeLock = await navigator.wakeLock?.request('screen') ?? null
  }
  catch {
    // Hidden tabs and browsers without the API refuse the lock. The sign still shows.
    wakeLock = null
  }
}

watch(tabla, (on) => {
  void holdScreen(on)
}, { immediate: true })

onScopeDispose(() => {
  void holdScreen(false)
})

function showTabla() {
  void router.push({ path: '/prototype/driver', query: { ...route.query, tabla: '1' } })
}

function hideTabla() {
  const query = { ...route.query }
  delete query.tabla
  void router.push({ path: '/prototype/driver', query })
}

function ping() {
  confirm.value = null
  toast.add({ title: copy.value.prototypeOnly, color: 'neutral' })
}

function maps(place: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(place)}`
}

const profile = computed(() => [[
  { label: copy.value.light, onSelect: () => { colorMode.preference = 'light' } },
  { label: copy.value.dark, onSelect: () => { colorMode.preference = 'dark' } },
  { label: copy.value.system, onSelect: () => { colorMode.preference = 'system' } },
], [
  { label: 'HR', onSelect: () => { void setLocale('hr') } },
  { label: 'EN', onSelect: () => { void setLocale('en') } },
], [
  { label: copy.value.signOut, onSelect: ping },
]])
</script>

<template>
  <div v-if="nextRide" class="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-md flex-col bg-[var(--tp-working)]">
    <header class="flex items-center justify-between gap-2 border-b border-muted px-4 py-3">
      <div>
        <p class="text-sm font-medium">
          {{ copy.driverTitle }}
        </p>
        <p class="text-xs text-muted">
          {{ copy.driverDate }}
        </p>
      </div>
      <UDropdownMenu :items="profile">
        <UButton color="neutral" variant="ghost" label="IH" :aria-label="copy.profile" />
      </UDropdownMenu>
    </header>

    <div class="flex-1 space-y-3 p-4">
      <UAlert color="neutral" variant="subtle" icon="i-lucide-file-warning" :title="copy.driverNotice" />

      <article class="space-y-3 rounded-md border border-muted bg-[var(--tp-panel)] p-4">
        <p class="text-xs text-muted">
          {{ copy.nextRide }}
        </p>
        <p class="text-4xl font-medium tabular-nums text-highlighted">
          {{ nextRide.time }}
        </p>
        <UBadge color="warning" variant="outline">
          {{ copy.states[nextRide.state] }}
        </UBadge>
        <p v-if="nextRide.flight" class="font-mono">
          {{ nextRide.flight }}
          <span class="font-sans text-sm text-muted">{{ nextRide.flightNote }}</span>
        </p>
        <p>
          <span class="text-xs text-muted">{{ copy.from }}</span>
          <a class="block text-primary underline-offset-2 hover:underline" :href="maps(nextRide.from)" target="_blank" rel="noopener noreferrer">{{ nextRide.from }}</a>
        </p>
        <p>
          <span class="text-xs text-muted">{{ copy.to }}</span>
          <a class="block text-primary underline-offset-2 hover:underline" :href="maps(nextRide.to)" target="_blank" rel="noopener noreferrer">{{ nextRide.to }}</a>
        </p>
        <p>
          {{ nextRide.guest }}
          <span class="text-xs text-muted">{{ nextRide.passengers }} {{ copy.passengers }}</span>
        </p>
        <p class="text-xs text-muted">
          {{ copy.luggage }} {{ nextRide.luggage }} · {{ copy.seats }} {{ nextRide.childSeats }}
        </p>
        <p v-if="nextRide.note">
          {{ nextRide.note }}
        </p>
        <p v-if="nextRide.tabla" class="rounded-md border border-muted bg-[var(--tp-working)] px-3 py-4 text-center text-2xl font-medium tracking-wide">
          {{ nextRide.tabla }}
        </p>
        <p v-if="nextRide.payment === 'cash'" class="tabular-nums">
          {{ money(nextRide.price) }}
          <span class="text-xs text-muted">{{ copy.payments.cash }}</span>
        </p>
        <div class="flex gap-2">
          <UButton type="button" class="h-12 flex-1" size="xl" :label="copy.accept" @click="ping" />
          <UButton type="button" class="h-12" size="xl" color="neutral" variant="outline" :label="copy.decline" @click="confirm = 'decline'" />
        </div>
        <UButton type="button" block color="neutral" variant="soft" icon="i-lucide-rectangle-horizontal" :label="copy.showSign" @click="showTabla" />
      </article>

      <section>
        <h2 class="mb-1 text-sm font-medium">
          {{ copy.otherRides }}
        </h2>
        <div v-for="ride in others" :key="ride.id" class="border-b border-muted">
          <button type="button" class="flex min-h-12 w-full items-center justify-between gap-2 py-2 text-left" @click="openId = openId === ride.id ? null : ride.id">
            <span class="tabular-nums">{{ ride.time }}</span>
            <span class="min-w-0 flex-1 truncate">{{ ride.guest }}</span>
            <span class="text-xs text-muted">{{ copy.states[ride.state] }}</span>
          </button>
          <div v-if="openId === ride.id" class="space-y-2 pb-3 text-sm">
            <p>{{ ride.from }} → {{ ride.to }}</p>
            <p v-if="ride.tabla" class="font-medium">
              {{ ride.tabla }}
            </p>
            <UButton
              v-if="ride.state === 'in-progress'"
              type="button"
              block
              class="h-12"
              :label="copy.actions.done"
              @click="confirm = 'done'"
            />
          </div>
        </div>
      </section>
    </div>

    <UModal
      :open="confirm !== null"
      :title="confirm === 'decline' ? copy.confirmDecline : confirm === 'no-show' ? copy.confirmNoShow : copy.confirmDone"
      @update:open="(open: boolean) => { if (!open) confirm = null }"
    >
      <template #body>
        <p class="text-sm">
          {{ copy.confirmBody }}
        </p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" :label="copy.back" @click="confirm = null" />
        <UButton :label="confirm === 'decline' ? copy.decline : copy.actions.done" @click="ping" />
      </template>
    </UModal>
  </div>

  <div
    v-if="tabla && nextRide?.tabla"
    class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6 text-black"
  >
    <p class="max-w-full text-center font-medium break-words" style="font-size: clamp(3rem, 14vw, 9rem); line-height: 1">
      {{ nextRide.tabla }}
    </p>
    <p class="mt-6 max-w-sm text-center text-sm">
      {{ copy.signHint }} {{ copy.wake }}
    </p>
    <UButton class="mt-8" color="neutral" variant="solid" :label="copy.close" @click="hideTabla" />
  </div>
</template>
