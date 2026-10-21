import type { Client, ClientOfficeBrief, DeclineAlert, Driver, LiveRefreshOutcome, Location, TransferDayRide, Vehicle } from '../../shared'
import { claimDayLoad, claimFullLoad, clientListSchema, driverListSchema, isCalendarDate, locationListSchema, operationalDateInTimeZone, transferDaySchema, vehicleListSchema } from '../../shared'
import { useOfficeHomeFeed } from './office-home-feed'

/**
 * Day list and the catalogs the row and the forms read.
 * A newer load wins: an older ticket does not overwrite it.
 */
export function useTransferDayLoad(timeZone: () => string, operationalDayStartHour: () => number) {
  // The board opens on the operational day that contains now.
  const day = ref(operationalDateInTimeZone(timeZone(), new Date(), operationalDayStartHour()))
  const rides = ref<TransferDayRide[]>([])
  const declineAlerts = ref<DeclineAlert[]>([])
  // Every Client, so the form can show a note for one with no Ride today.
  const clientBriefs = ref<ClientOfficeBrief[]>([])
  const clients = ref<Client[]>([])
  const locations = ref<Location[]>([])
  const drivers = ref<Driver[]>([])
  const vehicles = ref<Vehicle[]>([])
  // Pickup instants of unfinished unassigned Rides, any day. The seven-day
  // note reads the frame's office home snapshot, so Transfers does not
  // send a second office-home request (ADR-0038).
  const officeHome = useOfficeHomeFeed()
  const unassignedPickups = computed(() =>
    (officeHome.snapshot.value?.unassigned ?? []).map(row => ({ pickupAt: row.pickupAt })),
  )
  const loading = ref(true)
  const loadError = ref(false)

  // Shared with claimDayLoad. An unreadable day must not move this.
  let loadCounter = 0
  // The first successful read may show a skeleton. A later one keeps the rows.
  let opened = false

  async function fetchCatalogs() {
    // Each $fetch is a Promise.all item. Awaiting inside the array would run them one after another.
    const [clientList, locationList, driverList, vehicleList] = await Promise.all([
      $fetch('/api/clients').then(data => clientListSchema.parse(data)),
      // Archived rows stay in the catalog so a Ride keeps its place name.
      // The record form still offers only places that are not archived.
      $fetch('/api/locations', { query: { includeArchived: 'true' } }).then(data => locationListSchema.parse(data)),
      // Archived Drivers stay in the catalog so a Ride and a decline keep the name.
      // The assign picker still offers only Drivers that are not archived.
      $fetch('/api/drivers', { query: { includeArchived: 'true' } }).then(data => driverListSchema.parse(data)),
      // Archived Vehicles stay in the catalog so an assigned Ride keeps its plate.
      // The assign picker still offers only Vehicles that are not archived.
      $fetch('/api/vehicles', { query: { includeArchived: 'true' } }).then(data => vehicleListSchema.parse(data)),
    ])
    return {
      clients: clientList.clients,
      locations: locationList.locations,
      drivers: driverList.drivers,
      vehicles: vehicleList.vehicles,
    }
  }

  function applyCatalogs(catalogs: Awaited<ReturnType<typeof fetchCatalogs>>) {
    clients.value = catalogs.clients
    locations.value = catalogs.locations
    drivers.value = catalogs.drivers
    vehicles.value = catalogs.vehicles
  }

  async function fetchTransferDay(date: string) {
    // A refresh must not reuse the previous GET. The browser may otherwise
    // answer from its heuristic cache and the failure path never runs.
    return transferDaySchema.parse(await $fetch('/api/transfers', {
      query: { date },
      cache: 'no-store',
    }))
  }

  async function loadDay(): Promise<LiveRefreshOutcome> {
    // Claim only after the date is readable. The default-argument increment
    // used to retire an in-flight loadAll when the day was blank (issue #252).
    const claimed = claimDayLoad(loadCounter, day.value)
    if (!claimed)
      return 'stale'
    loadCounter = claimed.counter
    const ticket = claimed.ticket
    if (!opened)
      loading.value = true
    try {
      const listed = await fetchTransferDay(day.value)
      if (ticket !== loadCounter)
        return 'stale'
      rides.value = listed.rides
      declineAlerts.value = listed.declineAlerts
      clientBriefs.value = listed.clientBriefs
      loadError.value = false
      opened = true
      return 'ok'
    }
    catch {
      if (ticket !== loadCounter)
        return 'stale'
      // A failed refresh keeps the rows. Only the first read may show the error.
      if (!opened)
        loadError.value = true
      return 'fail'
    }
    finally {
      if (ticket === loadCounter)
        loading.value = false
    }
  }

  async function loadAll(): Promise<LiveRefreshOutcome> {
    const claimed = claimFullLoad(loadCounter)
    loadCounter = claimed.counter
    const ticket = claimed.ticket
    if (!opened)
      loading.value = true
    try {
      const dayPromise = isCalendarDate(day.value)
        ? fetchTransferDay(day.value)
        : Promise.resolve(null)
      const [catalogs, listed] = await Promise.all([
        fetchCatalogs(),
        dayPromise,
      ])
      // A day change during this load must not drop the catalogs. The newer
      // day read already replaced the rows.
      applyCatalogs(catalogs)
      if (ticket !== loadCounter)
        return 'stale'
      if (listed) {
        rides.value = listed.rides
        declineAlerts.value = listed.declineAlerts
        clientBriefs.value = listed.clientBriefs
      }
      loadError.value = false
      opened = true
      return 'ok'
    }
    catch {
      if (ticket !== loadCounter)
        return 'stale'
      if (!opened)
        loadError.value = true
      return 'fail'
    }
    finally {
      if (ticket === loadCounter)
        loading.value = false
    }
  }

  return {
    day,
    rides,
    declineAlerts,
    clientBriefs,
    clients,
    locations,
    drivers,
    vehicles,
    unassignedPickups,
    loading,
    loadError,
    loadDay,
    loadAll,
  }
}
