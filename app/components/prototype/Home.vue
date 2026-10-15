<script setup lang="ts">
import type { UrgentKind } from '../../prototype/day'
import { dayCounts, homeList, PROTOTYPE_RIDES, ridesInOrder, urgentRides } from '../../prototype/day'

const { copy } = usePrototypeCopy()
const { to } = usePrototypeQuery()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const counts = dayCounts(PROTOTYPE_RIDES)
const rideId = computed(() => typeof route.query.ride === 'string' ? route.query.ride : null)

const groupOrder: UrgentKind[] = ['past-pickup', 'unassigned-alarm', 'decline', 'landing', 'unclosed']
const groups = computed(() => {
  const urgent = urgentRides(PROTOTYPE_RIDES)
  return groupOrder
    .map(kind => ({ kind, rides: urgent.filter(ride => ride.urgent === kind) }))
    .filter(group => group.rides.length > 0)
})

const unassigned = ridesInOrder(PROTOTYPE_RIDES.filter(ride => homeList(ride) === 'unassigned'))
const waiting = ridesInOrder(PROTOTYPE_RIDES.filter(ride => homeList(ride) === 'waiting'))
const inProgress = ridesInOrder(PROTOTYPE_RIDES.filter(ride => homeList(ride) === 'inProgress'))

const balance = computed(() => [
  { key: 'total', value: counts.total, filter: 'all' },
  { key: 'unassigned', value: counts.unassigned, filter: 'unassigned' },
  { key: 'waiting', value: counts.waiting, filter: 'waiting' },
  { key: 'assigned', value: counts.assignedNotStarted, filter: 'accepted' },
  { key: 'progress', value: counts.inProgress, filter: 'progress' },
  { key: 'done', value: counts.done, filter: 'closed' },
  { key: 'noShow', value: counts.noShow, filter: 'closed' },
  { key: 'cancelled', value: counts.cancelled, filter: 'closed' },
] as const)

function openRide(id: string) {
  void router.push(to('/prototype', { ride: id }))
}

function closeRide() {
  void router.push(to('/prototype', { ride: undefined }))
}

function ping() {
  toast.add({ title: copy.value.prototypeOnly, color: 'neutral' })
}
</script>

<template>
  <PrototypeStage :copy="copy" :ride-id="rideId" @close="closeRide">
    <div class="space-y-4 p-3 md:p-4">
      <header class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 class="text-sm font-medium text-highlighted">
            {{ copy.dayTitle }}
          </h1>
          <p class="text-xs text-muted">
            {{ copy.startHour }} · {{ copy.updated }}
          </p>
        </div>
        <USwitch :label="copy.autoRefresh" :model-value="true" />
      </header>

      <div class="grid grid-cols-4 gap-1 md:grid-cols-8">
        <UButton
          v-for="part in balance"
          :key="part.key"
          color="neutral"
          variant="outline"
          class="h-auto flex-col px-1 py-2"
          :to="to('/prototype/transfers', { filter: part.filter, ride: undefined, day: undefined })"
        >
          <span class="text-lg tabular-nums text-highlighted">{{ part.value }}</span>
          <span class="text-[11px] text-muted">{{ copy.counts[part.key] }}</span>
        </UButton>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="space-y-4">
          <section>
            <h2 class="mb-1 text-sm font-medium">
              {{ copy.attention }}
              <span class="tabular-nums text-muted">{{ groups.reduce((sum, group) => sum + group.rides.length, 0) }}</span>
            </h2>
            <div v-for="group in groups" :key="group.kind" class="mb-2">
              <h3 class="px-2 text-xs text-warning">
                {{ copy.groups[group.kind] }}
                <span class="tabular-nums">{{ group.rides.length }}</span>
              </h3>
              <PrototypeRideRow
                v-for="ride in group.rides"
                :key="ride.id"
                :copy="copy"
                :ride="ride"
                :selected="ride.id === rideId"
                @open="openRide(ride.id)"
                @command="ping"
              />
            </div>
          </section>
          <section>
            <h2 class="mb-1 text-sm font-medium">
              {{ copy.unassignedList }}
            </h2>
            <PrototypeRideRow
              v-for="ride in unassigned"
              :key="ride.id"
              :copy="copy"
              :ride="ride"
              :selected="ride.id === rideId"
              @open="openRide(ride.id)"
              @command="ping"
            />
          </section>
          <section>
            <h2 class="mb-1 text-sm font-medium">
              {{ copy.waitingList }}
            </h2>
            <PrototypeRideRow
              v-for="ride in waiting"
              :key="ride.id"
              :copy="copy"
              :ride="ride"
              :selected="ride.id === rideId"
              @open="openRide(ride.id)"
              @command="ping"
            />
          </section>
        </div>
        <div class="space-y-4">
          <section class="lg:order-none">
            <h2 class="mb-1 text-sm font-medium">
              {{ copy.progressList }}
            </h2>
            <PrototypeRideRow
              v-for="ride in inProgress"
              :key="ride.id"
              :copy="copy"
              :ride="ride"
              :selected="ride.id === rideId"
              @open="openRide(ride.id)"
              @command="ping"
            />
          </section>
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-file-warning"
            :title="copy.documents"
            :description="`${copy.documentDriver} · ${copy.documentVehicle}`"
          />
        </div>
      </div>
    </div>
  </PrototypeStage>
</template>
