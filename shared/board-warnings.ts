import type { ExpiringDocumentKind } from './expiring-documents'
import type { ScheduleRide } from './ride-schedule'
import type { RideState } from './transfer'
import { z } from 'zod'
import { isCalendarDate } from './date'
import { EXPIRING_DOCUMENT_KINDS, expiringDocumentKindSchema } from './expiring-documents'
import { judgeSchedule } from './ride-schedule'

/**
 * What the day board shows on one Ride (issue #212). Derived when the day
 * is read. Nothing is stored, nothing is sent, and no command reads this.
 */
export const boardWarningsSchema = z.object({
  expiredDocuments: z.array(expiringDocumentKindSchema),
  rosterMismatch: z.boolean(),
  overlappingRideIds: z.array(z.uuid()),
})

export type BoardWarnings = z.infer<typeof boardWarningsSchema>

/** An assigned or accepted Ride, plus the instants the schedule judge needs. */
export interface BoardWarningRide {
  readonly rideId: string
  readonly state: RideState
  readonly pickupAt: Date
  readonly landingAt: Date | null
  readonly driverId: string | null
  readonly vehicleId: string | null
}

/**
 * Expiry days for this Ride's Driver and Vehicle. A missing day is not a
 * document. The caller loads the Ride's own Vehicle even when it is archived.
 */
export interface BoardWarningDocuments {
  readonly drivingLicenceExpiresOn?: string | null
  readonly transportLicenceExpiresOn?: string | null
  readonly registrationExpiresOn?: string | null
  readonly technicalInspectionExpiresOn?: string | null
  readonly insuranceExpiresOn?: string | null
}

const DOCUMENT_DAY: Record<ExpiringDocumentKind, keyof BoardWarningDocuments> = {
  driving_licence: 'drivingLicenceExpiresOn',
  transport_licence: 'transportLicenceExpiresOn',
  vehicle_registration: 'registrationExpiresOn',
  technical_inspection: 'technicalInspectionExpiresOn',
  insurance: 'insuranceExpiresOn',
}

export function emptyBoardWarnings(): BoardWarnings {
  return {
    expiredDocuments: [],
    rosterMismatch: false,
    overlappingRideIds: [],
  }
}

/**
 * Warnings for one Ride. `pickupDate` is the calendar date of the pickup in
 * the Tenant time zone, which is not the operational day. `rosteredDriverId`
 * is the Driver the roster gives this Vehicle on that date, or null when
 * that Vehicle has no row. `others` are the other occupying Rides. The
 * overlap uses {@link judgeSchedule} unchanged, so a tight gap and a true
 * overlap are one warning and a gap equal to the relocation gap is none.
 */
export function deriveBoardWarnings(input: {
  readonly ride: BoardWarningRide
  readonly pickupDate: string
  readonly documents: BoardWarningDocuments
  readonly rosteredDriverId: string | null
  readonly others: readonly ScheduleRide[]
  readonly durationMinutes: number
  readonly gapMinutes: number
}): BoardWarnings {
  if (!isCalendarDate(input.pickupDate))
    throw new RangeError('Pickup date is not a calendar date.')
  if (input.ride.state !== 'assigned' && input.ride.state !== 'accepted')
    return emptyBoardWarnings()

  return {
    expiredDocuments: expiredDocuments(input.pickupDate, input.documents),
    rosterMismatch: input.rosteredDriverId !== null
      && input.ride.driverId !== null
      && input.rosteredDriverId !== input.ride.driverId,
    overlappingRideIds: overlappingRideIds(input),
  }
}

function expiredDocuments(pickupDate: string, documents: BoardWarningDocuments): ExpiringDocumentKind[] {
  const expired: ExpiringDocumentKind[] = []
  for (const kind of EXPIRING_DOCUMENT_KINDS) {
    const day = documents[DOCUMENT_DAY[kind]]
    // The stored day is the last valid day, so the pickup day itself is quiet.
    if (typeof day === 'string' && isCalendarDate(day) && day < pickupDate)
      expired.push(kind)
  }
  return expired
}

function overlappingRideIds(input: {
  readonly ride: BoardWarningRide
  readonly others: readonly ScheduleRide[]
  readonly durationMinutes: number
  readonly gapMinutes: number
}): string[] {
  const { ride } = input
  if (ride.driverId === null || ride.vehicleId === null)
    return []
  const verdict = judgeSchedule(
    {
      rideId: ride.rideId,
      pickupAt: ride.pickupAt,
      landingAt: ride.landingAt,
      driverId: ride.driverId,
      vehicleId: ride.vehicleId,
    },
    input.others,
    input.durationMinutes,
    input.gapMinutes,
  )
  const ids: string[] = []
  for (const clash of [...verdict.overlaps, ...verdict.tightGaps]) {
    if (!ids.includes(clash.rideId))
      ids.push(clash.rideId)
  }
  return ids
}
