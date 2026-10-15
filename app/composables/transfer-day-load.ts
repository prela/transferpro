import type { Client, DeclineAlert, Driver, Location, TransferDayRide, Vehicle } from '../../shared'
import { clientListSchema, driverListSchema, isCalendarDate, locationListSchema, operationalDateInTimeZone, transferDaySchema, vehicleListSchema } from '../../shared'

/**
 * Day list and the catalogs the row and the forms read.
 * A newer load wins: an older ticket does not overwrite it.
 */
export function useTransferDayLoad(timeZone: () => string, operationalDayStartHour: () => number) {
  // The board opens on the operational day that contains now.
  const day = ref(operationalDateInTimeZone(timeZone(), new Date(), operationalDayStartHour()))
  const rides = ref<TransferDayRide[]>([])
  const declineAlerts = ref<DeclineAlert[]>([])
  const clients = ref<Client[]>([])
  const locations = ref<Location[]>([])
  const drivers = ref<Driver[]>([])
  const vehicles = ref<Vehicle[]>([])
  const loading = ref(true)
  const loadError = ref(false)

  let loadTicket = 0

  async function fetchCatalogs() {
    // Each $fetch is a Promise.all item. Awaiting inside the array would run them one after another.
    const [clientList, locationList, driverList, vehicleList] = await Promise.all([
      $fetch('/api/clients').then(data => clientListSchema.parse(data)),
      // Archived rows stay in the catalog so a Ride keeps its place name.
      // The record form still offers only places that are not archived.
      $fetch('/api/locations', { query: { includeArchived: 'true' } }).then(data => locationListSchema.parse(data)),
      $fetch('/api/drivers').then(data => driverListSchema.parse(data)),
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
    return transferDaySchema.parse(await $fetch('/api/transfers', { query: { date } }))
  }

  async function loadDay(ticket = ++loadTicket) {
    if (!isCalendarDate(day.value))
      return
    loading.value = true
    loadError.value = false
    try {
      const listed = await fetchTransferDay(day.value)
      if (ticket !== loadTicket)
        return
      rides.value = listed.rides
      declineAlerts.value = listed.declineAlerts
    }
    catch {
      if (ticket !== loadTicket)
        return
      loadError.value = true
    }
    finally {
      if (ticket === loadTicket)
        loading.value = false
    }
  }

  async function loadAll() {
    const ticket = ++loadTicket
    loading.value = true
    loadError.value = false
    try {
      const dayPromise = isCalendarDate(day.value)
        ? fetchTransferDay(day.value)
        : Promise.resolve(null)
      const [catalogs, listed] = await Promise.all([fetchCatalogs(), dayPromise])
      // A day change during this load must not drop the catalogs. The newer
      // day read already replaced the rows.
      applyCatalogs(catalogs)
      if (ticket !== loadTicket)
        return
      if (listed) {
        rides.value = listed.rides
        declineAlerts.value = listed.declineAlerts
      }
    }
    catch {
      if (ticket !== loadTicket)
        return
      loadError.value = true
    }
    finally {
      if (ticket === loadTicket)
        loading.value = false
    }
  }

  return {
    day,
    rides,
    declineAlerts,
    clients,
    locations,
    drivers,
    vehicles,
    loading,
    loadError,
    loadDay,
    loadAll,
  }
}
