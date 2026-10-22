import type { Client, ClientOfficeBrief, DeclineAlert, Driver, LiveRefreshOutcome, OfficeLocation, Partner, PartnerOfficeContact, TransferDayRide, Vehicle } from '../../shared'
import { claimDayLoad, claimFullLoad, clientListSchema, driverListSchema, isCalendarDate, officeLocationListSchema, operationalDateInTimeZone, partnerListSchema, transferDaySchema, vehicleListSchema } from '../../shared'
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
  // Phone and email for Partners a Ride on this day is still handed to.
  // The Driver's read does not carry this list (ADR-0049).
  const partnerBriefs = ref<PartnerOfficeContact[]>([])
  const clients = ref<Client[]>([])
  const locations = ref<OfficeLocation[]>([])
  const drivers = ref<Driver[]>([])
  const vehicles = ref<Vehicle[]>([])
  // Archived Partners stay so a Ride already handed to one keeps the name.
  // The picker still offers only Partners that are not archived.
  const partners = ref<Partner[]>([])
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

  async function fetchOfficeLocations() {
    // Archived rows stay in the catalog so a Ride keeps its place name.
    // The record form still offers only places that are not archived.
    // The office list carries embedUrl (ADR-0052). A live refresh must not
    // reuse a cached list, or an open map would keep a reference that is gone.
    return officeLocationListSchema.parse(await $fetch('/api/locations', {
      query: { includeArchived: 'true' },
      cache: 'no-store',
    }))
  }

  async function fetchCatalogs() {
    // Each $fetch is a Promise.all item. Awaiting inside the array would run them one after another.
    const [clientList, locationList, driverList, vehicleList, partnerList] = await Promise.all([
      $fetch('/api/clients').then(data => clientListSchema.parse(data)),
      fetchOfficeLocations(),
      // Archived Drivers stay in the catalog so a Ride and a decline keep the name.
      // The assign picker still offers only Drivers that are not archived.
      $fetch('/api/drivers', { query: { includeArchived: 'true' } }).then(data => driverListSchema.parse(data)),
      // Archived Vehicles stay in the catalog so an assigned Ride keeps its plate.
      // The assign picker still offers only Vehicles that are not archived.
      $fetch('/api/vehicles', { query: { includeArchived: 'true' } }).then(data => vehicleListSchema.parse(data)),
      // Archived Partners stay so a handed-off Ride keeps the name (ADR-0049).
      // The handoff picker still offers only Partners that are not archived.
      $fetch('/api/partners', { query: { includeArchived: 'true' } }).then(data => partnerListSchema.parse(data)),
    ])
    return {
      clients: clientList.clients,
      locations: locationList.locations,
      drivers: driverList.drivers,
      vehicles: vehicleList.vehicles,
      partners: partnerList.partners,
    }
  }

  function applyCatalogs(catalogs: Awaited<ReturnType<typeof fetchCatalogs>>) {
    clients.value = catalogs.clients
    locations.value = catalogs.locations
    drivers.value = catalogs.drivers
    vehicles.value = catalogs.vehicles
    partners.value = catalogs.partners
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
      // Locations travel with the day so a refresh can replace or clear an
      // Embed URL under an open map (ADR-0052). A failed location read keeps
      // the list already on screen. The day still updates. The other catalogs
      // stay as they were until the next full load.
      const [dayResult, locationResult] = await Promise.allSettled([
        fetchTransferDay(day.value),
        fetchOfficeLocations(),
      ])
      if (dayResult.status === 'rejected')
        throw dayResult.reason
      if (ticket !== loadCounter)
        return 'stale'
      const listed = dayResult.value
      rides.value = listed.rides
      declineAlerts.value = listed.declineAlerts
      clientBriefs.value = listed.clientBriefs
      partnerBriefs.value = listed.partnerBriefs
      if (locationResult.status === 'fulfilled')
        locations.value = locationResult.value.locations
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
        partnerBriefs.value = listed.partnerBriefs
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
    partnerBriefs,
    clients,
    locations,
    drivers,
    vehicles,
    partners,
    unassignedPickups,
    loading,
    loadError,
    loadDay,
    loadAll,
  }
}
