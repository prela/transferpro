<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { DayFilter, DayKey, PrototypeRide } from '../../prototype/day'
import { filterCounts, matchesFilter, PROTOTYPE_RIDES, ridesInOrder, todayRides } from '../../prototype/day'
import { money, paymentLabel, rowAction, stateBadge, urgentLabel, warningLabels } from '../../prototype/present'

const { copy } = usePrototypeCopy()
const { route, to } = usePrototypeQuery()
const toast = useToast()
const router = useRouter()

const chipFilters = ['all', 'urgent', 'warnings', 'unassigned', 'waiting', 'progress', 'closed'] as const
const filter = computed<DayFilter>(() => {
  const value = route.query.filter
  if (value === 'accepted')
    return 'accepted'
  return chipFilters.find(item => item === value) ?? 'all'
})
const day = computed<DayKey>(() => {
  const value = route.query.day
  if (value === 'tomorrow' || value === 'saturday')
    return value
  return 'today'
})
const search = computed({
  get: () => typeof route.query.q === 'string' ? route.query.q : '',
  set: (value: string) => {
    void router.replace(to('/prototype/transfers', { q: value || undefined }))
  },
})
const client = computed({
  get: () => typeof route.query.client === 'string' ? route.query.client : 'all',
  set: (value: string) => {
    void router.replace(to('/prototype/transfers', { client: value === 'all' ? undefined : value }))
  },
})
const driver = computed({
  get: () => typeof route.query.driver === 'string' ? route.query.driver : 'all',
  set: (value: string) => {
    void router.replace(to('/prototype/transfers', { driver: value === 'all' ? undefined : value }))
  },
})
const rideId = computed(() => typeof route.query.ride === 'string' ? route.query.ride : null)

const dayRides = computed(() => ridesInOrder(PROTOTYPE_RIDES.filter(ride => ride.day === day.value)))
const counts = filterCounts(day.value === 'today' ? todayRides() : dayRides.value)
const clients = [...new Set(todayRides().map(ride => ride.client))]
const drivers = [...new Set(todayRides().flatMap(ride => ride.driver ? [ride.driver] : []))]

const shown = computed(() => dayRides.value.filter((ride) => {
  if (!matchesFilter(ride, filter.value))
    return false
  if (client.value !== 'all' && ride.client !== client.value)
    return false
  if (driver.value !== 'all' && ride.driver !== driver.value)
    return false
  const query = search.value.trim().toLowerCase()
  if (!query)
    return true
  const haystack = [ride.guest, ride.flight, ride.clientRef, ride.tabla].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query)
}))

const columns = computed<TableColumn<PrototypeRide>[]>(() => [
  { id: 'time', accessorKey: 'time', header: copy.value.columns.time },
  { id: 'flight', accessorKey: 'flight', header: copy.value.columns.flight },
  { id: 'guest', accessorKey: 'guest', header: copy.value.columns.guest },
  { id: 'route', header: copy.value.columns.route },
  { id: 'client', accessorKey: 'client', header: copy.value.columns.client },
  { id: 'driver', header: copy.value.columns.driver },
  { id: 'state', header: copy.value.columns.state },
  { id: 'price', accessorKey: 'price', header: copy.value.columns.price },
  { id: 'actions', header: '' },
])

function openRide(id: string) {
  void router.push(to('/prototype/transfers', { ride: id }))
}

function closeRide() {
  void router.push(to('/prototype/transfers', { ride: undefined }))
}

function ping() {
  toast.add({ title: copy.value.prototypeOnly, color: 'neutral' })
}

function marks(ride: PrototypeRide): string[] {
  const urgent = urgentLabel(copy.value, ride)
  return [urgent, ...warningLabels(copy.value, ride)].filter((mark): mark is string => mark !== null)
}

function closed(ride: PrototypeRide): boolean {
  return ride.state === 'done' || ride.state === 'no-show' || ride.state === 'cancelled'
}

function actionLabel(ride: PrototypeRide): string {
  const action = rowAction(ride.state)
  return action ? copy.value.actions[action] : ''
}
</script>

<template>
  <PrototypeStage :copy="copy" :ride-id="rideId" @close="closeRide">
    <div class="space-y-3 p-3 md:p-4">
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-left"
          :aria-label="copy.days.yesterday"
          :to="to('/prototype/transfers', { day: undefined, ride: undefined })"
        />
        <span class="text-sm font-medium">{{ copy.dayTitle }}</span>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-right"
          :aria-label="copy.days.tomorrow"
          :to="to('/prototype/transfers', { day: 'tomorrow', ride: undefined })"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :label="copy.note"
          :to="to('/prototype/transfers', { day: 'tomorrow', filter: 'unassigned', ride: undefined })"
        />
        <span class="ml-auto text-xs text-muted">{{ copy.updated }}</span>
        <USwitch :label="copy.autoRefresh" :model-value="true" />
      </div>

      <div class="flex flex-wrap gap-1">
        <UButton
          v-for="item in chipFilters"
          :key="item"
          size="xs"
          color="neutral"
          :variant="filter === item ? 'solid' : 'ghost'"
          :label="`${copy.filters[item]} (${counts[item]})`"
          :to="to('/prototype/transfers', { filter: item === 'all' ? undefined : item, ride: undefined })"
        />
      </div>

      <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <UInput v-model="search" icon="i-lucide-search" :placeholder="copy.search" :aria-label="copy.search" />
        <USelect
          v-model="client"
          :aria-label="copy.client"
          :items="[{ label: copy.allClients, value: 'all' }, ...clients.map(name => ({ label: name, value: name }))]"
        />
        <USelect
          v-model="driver"
          :aria-label="copy.driver"
          :items="[{ label: copy.allDrivers, value: 'all' }, ...drivers.map(name => ({ label: name, value: name }))]"
        />
      </div>

      <p v-if="shown.length === 0" class="text-sm text-muted">
        {{ copy.empty }}
      </p>

      <div v-if="shown.length > 0" class="md:hidden">
        <PrototypeRideRow
          v-for="ride in shown"
          :key="ride.id"
          :copy="copy"
          :ride="ride"
          :selected="ride.id === rideId"
          @open="openRide(ride.id)"
          @command="ping"
        />
      </div>

      <UTable
        v-if="shown.length > 0"
        :data="shown"
        :columns="columns"
        :get-row-id="(ride: PrototypeRide) => ride.id"
        class="hidden md:block"
        :ui="{ tr: 'h-[var(--tp-row)]', td: 'py-0 align-middle text-sm', th: 'py-1 text-xs font-medium text-muted' }"
        @select="(_event: Event, row: { original: PrototypeRide }) => openRide(row.original.id)"
      >
        <template #time-cell="{ row }">
          <span class="tabular-nums" :class="closed(row.original) ? 'text-muted' : ''">
            {{ row.original.time }}
            <span v-if="row.original.afterMidnight" class="block text-xs">{{ copy.midnight }}</span>
          </span>
        </template>
        <template #flight-cell="{ row }">
          <span v-if="row.original.flight" class="font-mono text-xs">
            {{ row.original.flight }}
            <span v-if="row.original.flightNote" class="block font-sans text-muted">{{ row.original.flightNote }}</span>
          </span>
        </template>
        <template #guest-cell="{ row }">
          <span :class="closed(row.original) ? 'text-muted' : ''">
            {{ row.original.guest }}
            <span class="text-xs text-muted">{{ row.original.passengers }}</span>
            <UIcon v-if="row.original.luggage" name="i-lucide-briefcase" class="ml-1 size-3 text-muted" />
            <UIcon v-if="row.original.childSeats" name="i-lucide-baby" class="ml-1 size-3 text-muted" />
          </span>
        </template>
        <template #route-cell="{ row }">
          <span class="block max-w-52 truncate">
            <UIcon v-if="row.original.airport" name="i-lucide-plane" class="mr-1 size-3 text-muted" />
            {{ row.original.from }} → {{ row.original.to }}
          </span>
        </template>
        <template #client-cell="{ row }">
          <span class="block max-w-40 truncate">{{ row.original.client }}</span>
          <span v-if="row.original.clientRef" class="block text-xs text-muted">{{ row.original.clientRef }}</span>
        </template>
        <template #driver-cell="{ row }">
          <span v-if="row.original.driver">
            {{ row.original.driver }}
            <span class="block font-mono text-xs text-muted">{{ row.original.plate }}</span>
          </span>
          <span v-else>{{ copy.unassignedDriver }}</span>
        </template>
        <template #state-cell="{ row }">
          <UBadge size="sm" :color="stateBadge(row.original.state).color" :variant="stateBadge(row.original.state).variant">
            {{ copy.states[row.original.state] }}
          </UBadge>
          <span v-if="marks(row.original).length" class="mt-0.5 block max-w-40 truncate text-xs text-warning">
            {{ marks(row.original).join(' · ') }}
          </span>
        </template>
        <template #price-cell="{ row }">
          <span class="block text-right tabular-nums">{{ money(row.original.price) }}</span>
          <span class="block text-right text-xs text-muted">{{ paymentLabel(copy, row.original) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end" @click.stop>
            <UButton
              v-if="rowAction(row.original.state)"
              type="button"
              size="xs"
              color="primary"
              variant="soft"
              class="h-7"
              :label="actionLabel(row.original)"
              @click="ping"
            />
            <UDropdownMenu
              :items="[[
                { label: copy.actions.correct, onSelect: ping },
                { label: copy.actions.duplicate, onSelect: ping },
                { label: copy.actions.returnRide, onSelect: ping },
                { label: copy.actions.unassign, onSelect: ping },
                { label: copy.actions.cancel, color: 'error', onSelect: ping },
              ]]"
            >
              <UButton
                type="button"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis-vertical"
                class="h-7"
                :aria-label="copy.actions.more"
              />
            </UDropdownMenu>
          </div>
        </template>
      </UTable>
    </div>
  </PrototypeStage>
</template>
