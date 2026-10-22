import type { TransferDayRide } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { calendarDateInTimeZone, deriveBoardWarnings } from '../../../../shared'
import { capacityPorts, readBoardFullyBooked, readBoardOccupation, readBoardUnavailability, tenantFleet } from '../../capacity'
import { loadDriverDocumentExpiry } from '../../drivers'
import { rosteredDriversOnDates } from '../../roster'
import { loadVehicleDocumentExpiry } from '../../vehicles'
import { rideOccupation } from './occupation-port'

/**
 * Fill warnings on a day list. Display only: no audit entry and no mail.
 * A neighbour on another operational day can be named and is not added
 * to the list. The Ride's own Vehicle is read even when it is archived.
 * The overlap warning comes from capacity (ADR-0034): capacity reads the
 * neighbours through the occupation port, and the shared contract judges.
 * The unavailability warning is capacity's too: it reads the live windows
 * of the listed Drivers, Vehicles, and Partners once, so removing or moving
 * a window changes the warning on the next read. A handed-off Ride warns
 * when its Partner is covered. Popunjeno is derived on the same read, on an
 * unfinished unassigned Ride whose window is fully booked.
 */
export async function applyBoardWarnings(
  transaction: TenantTransaction,
  role: string,
  rides: readonly TransferDayRide[],
  timeZone: string,
  day: string,
  startHour: number,
  transferDurationMinutes: number,
  relocationGapMinutes: number,
): Promise<TransferDayRide[]> {
  const occupying = rides.filter(ride => ride.state === 'assigned' || ride.state === 'accepted')
  const handedOff = rides.filter(ride => ride.state === 'handed_off' && ride.partnerId !== null)
  const unassigned = rides.filter(ride => ride.state === 'unassigned')
  const ports = capacityPorts(transaction, rideOccupation(transaction))
  const fullyBooked = unassigned.length === 0
    ? new Set<string>()
    : await readBoardFullyBooked(ports, tenantFleet(transaction), role, {
        rides: unassigned.map(ride => ({
          rideId: ride.rideId,
          pickupAt: new Date(ride.pickupAt),
          landingAt: ride.landingAt == null ? null : new Date(ride.landingAt),
        })),
        durationMinutes: transferDurationMinutes,
      })
  if (occupying.length === 0 && handedOff.length === 0) {
    return rides.map(ride => ({
      ...ride,
      warnings: deriveBoardWarnings({
        ride: boardRide(ride),
        pickupDate: calendarDateInTimeZone(timeZone, new Date(ride.pickupAt)),
        documents: {},
        rosteredDriverId: null,
        others: [],
        durationMinutes: transferDurationMinutes,
        gapMinutes: relocationGapMinutes,
        fullyBooked: fullyBooked.has(ride.rideId),
      }),
    }))
  }

  const driverIds = idsOf(occupying.map(ride => ride.driverId))
  const vehicleIds = idsOf(occupying.map(ride => ride.vehicleId))
  const pickupDates = occupying.map(ride => calendarDateInTimeZone(timeZone, new Date(ride.pickupAt)))
  // One session client. A parallel read on it fails with a query already in progress.
  const drivers = await loadDriverDocumentExpiry(transaction, role, driverIds)
  const vehicles = await loadVehicleDocumentExpiry(transaction, role, vehicleIds)
  const roster = await rosteredDriversOnDates(transaction, role, pickupDates)
  const others = await readBoardOccupation(rideOccupation(transaction), role, {
    day,
    timeZone,
    startHour,
    rides: occupying.map(ride => ({
      driverId: ride.driverId,
      vehicleId: ride.vehicleId,
      pickupAt: new Date(ride.pickupAt),
      landingAt: ride.landingAt == null ? null : new Date(ride.landingAt),
    })),
  })
  const unavailable = await readBoardUnavailability(ports.windows, role, {
    rides: [...occupying, ...handedOff].map(ride => ({
      rideId: ride.rideId,
      driverId: ride.driverId,
      vehicleId: ride.vehicleId,
      partnerId: ride.partnerId,
      pickupAt: new Date(ride.pickupAt),
      landingAt: ride.landingAt == null ? null : new Date(ride.landingAt),
    })),
    durationMinutes: transferDurationMinutes,
  })
  const driverExpiry = new Map(drivers.map(row => [row.id, row]))
  const vehicleExpiry = new Map(vehicles.map(row => [row.id, row]))
  const rostered = new Map(roster.map(row => [`${row.rosterDate}:${row.vehicleId}`, row.driverId]))

  return rides.map((ride) => {
    const pickupDate = calendarDateInTimeZone(timeZone, new Date(ride.pickupAt))
    const driver = ride.driverId == null ? undefined : driverExpiry.get(ride.driverId)
    const vehicle = ride.vehicleId == null ? undefined : vehicleExpiry.get(ride.vehicleId)
    return {
      ...ride,
      warnings: deriveBoardWarnings({
        ride: boardRide(ride),
        pickupDate,
        documents: {
          drivingLicenceExpiresOn: driver?.drivingLicenceExpiresOn ?? null,
          transportLicenceExpiresOn: driver?.transportLicenceExpiresOn ?? null,
          registrationExpiresOn: vehicle?.registrationExpiresOn ?? null,
          technicalInspectionExpiresOn: vehicle?.technicalInspectionExpiresOn ?? null,
          insuranceExpiresOn: vehicle?.insuranceExpiresOn ?? null,
        },
        rosteredDriverId: ride.vehicleId == null
          ? null
          : rostered.get(`${pickupDate}:${ride.vehicleId}`) ?? null,
        others,
        durationMinutes: transferDurationMinutes,
        gapMinutes: relocationGapMinutes,
        unavailable: unavailable.get(ride.rideId),
        fullyBooked: fullyBooked.has(ride.rideId),
      }),
    }
  })
}

function idsOf(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((id): id is string => id !== null))]
}

function boardRide(ride: TransferDayRide) {
  return {
    rideId: ride.rideId,
    state: ride.state,
    pickupAt: new Date(ride.pickupAt),
    landingAt: ride.landingAt == null ? null : new Date(ride.landingAt),
    driverId: ride.driverId,
    vehicleId: ride.vehicleId,
  }
}
