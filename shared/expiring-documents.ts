import type { Driver } from './driver'
import type { TenantRole } from './tenant-role'
import type { Vehicle } from './vehicle'
import { z } from 'zod'
import { addCalendarDays, isCalendarDate } from './date'

export { addCalendarDays }

/**
 * How far ahead the dashboard looks, in calendar days, including today.
 * The empty-state copy in both locales states this same count.
 */
export const EXPIRY_WINDOW_DAYS = 30

/**
 * The five documents the dashboard can list. Values stay stable because
 * the locale files key copy off them.
 */
export const EXPIRING_DOCUMENT_KINDS = [
  'driving_licence',
  'transport_licence',
  'vehicle_registration',
  'technical_inspection',
  'insurance',
] as const

export const expiringDocumentKindSchema = z.enum(EXPIRING_DOCUMENT_KINDS)

export type ExpiringDocumentKind = z.infer<typeof expiringDocumentKindSchema>

export const EXPIRING_DOCUMENT_STATUSES = ['expired', 'expiring'] as const

export const expiringDocumentStatusSchema = z.enum(EXPIRING_DOCUMENT_STATUSES)

export type ExpiringDocumentStatus = z.infer<typeof expiringDocumentStatusSchema>

const calendarDay = z.string().refine(isCalendarDate)

/**
 * One row of the dashboard list. The label is the Driver name or the plate,
 * which the office already sees on those screens. The phone is not here.
 */
export const expiringDocumentSchema = z.object({
  subject: z.enum(['driver', 'vehicle']),
  subjectId: z.uuid(),
  subjectLabel: z.string().min(1),
  kind: expiringDocumentKindSchema,
  expiresOn: calendarDay,
  status: expiringDocumentStatusSchema,
})

export type ExpiringDocument = z.infer<typeof expiringDocumentSchema>

export const expiringDocumentListSchema = z.object({
  documents: z.array(expiringDocumentSchema),
})

export type ExpiringDocumentList = z.infer<typeof expiringDocumentListSchema>

/**
 * Driving licence before transport licence, then the three vehicle documents.
 * Two rows on the same day use this order so the list does not jump around.
 */
const KIND_RANK: Record<ExpiringDocumentKind, number> = {
  driving_licence: 0,
  transport_licence: 1,
  vehicle_registration: 2,
  technical_inspection: 3,
  insurance: 4,
}

interface DatedDocument {
  readonly subject: 'driver' | 'vehicle'
  readonly subjectId: string
  readonly subjectLabel: string
  readonly kind: ExpiringDocumentKind
  readonly expiresOn: string
}

/**
 * Documents that are already expired, or that expire within 30 calendar days
 * of `today`, including today and day 30.
 * The stored date is the last valid day, so a document dated `today` is
 * expiring, not expired.
 * A driver sees only the two licences of the Driver linked to `userId`,
 * and no vehicle row, even when vehicles were passed in.
 * An archived vehicle is left out. Drivers have no inactive or archived
 * state, so every Driver is eligible for the office.
 * Expired rows come first, then the soonest expiry. The same day is ordered
 * by document kind, then by label.
 */
export function selectExpiringDocuments(input: {
  readonly role: TenantRole
  readonly userId: string
  readonly today: string
  readonly drivers: readonly Driver[]
  readonly vehicles: readonly Vehicle[]
}): ExpiringDocument[] {
  if (!isCalendarDate(input.today))
    throw new RangeError('Not a calendar date.')

  const deadline = addCalendarDays(input.today, EXPIRY_WINDOW_DAYS)
  const documents = sources(input)
    .filter(document => document.expiresOn <= deadline)
    .map((document): ExpiringDocument => ({
      ...document,
      status: document.expiresOn < input.today ? 'expired' : 'expiring',
    }))
  documents.sort(compareDocuments)
  return documents
}

function sources(input: {
  readonly role: TenantRole
  readonly userId: string
  readonly drivers: readonly Driver[]
  readonly vehicles: readonly Vehicle[]
}): DatedDocument[] {
  const drivers = input.role === 'driver'
    ? input.drivers.filter(driver => driver.memberUserId === input.userId)
    : input.drivers
  const vehicles = input.role === 'driver'
    ? []
    : input.vehicles.filter(vehicle => vehicle.archivedAt === null)

  const rows: DatedDocument[] = []
  for (const driver of drivers) {
    rows.push(driverDocument(driver, 'driving_licence', driver.drivingLicenceExpiresOn))
    rows.push(driverDocument(driver, 'transport_licence', driver.transportLicenceExpiresOn))
  }
  for (const vehicle of vehicles) {
    rows.push(vehicleDocument(vehicle, 'vehicle_registration', vehicle.registrationExpiresOn))
    rows.push(vehicleDocument(vehicle, 'technical_inspection', vehicle.technicalInspectionExpiresOn))
    rows.push(vehicleDocument(vehicle, 'insurance', vehicle.insuranceExpiresOn))
  }
  return rows
}

function driverDocument(driver: Driver, kind: ExpiringDocumentKind, expiresOn: string): DatedDocument {
  return {
    subject: 'driver',
    subjectId: driver.id,
    subjectLabel: driver.name,
    kind,
    expiresOn,
  }
}

function vehicleDocument(vehicle: Vehicle, kind: ExpiringDocumentKind, expiresOn: string): DatedDocument {
  return {
    subject: 'vehicle',
    subjectId: vehicle.id,
    subjectLabel: vehicle.registrationPlate,
    kind,
    expiresOn,
  }
}

function compareDocuments(a: ExpiringDocument, b: ExpiringDocument): number {
  if (a.status !== b.status)
    return a.status === 'expired' ? -1 : 1
  if (a.expiresOn !== b.expiresOn)
    return a.expiresOn < b.expiresOn ? -1 : 1
  const kindGap = KIND_RANK[a.kind] - KIND_RANK[b.kind]
  if (kindGap !== 0)
    return kindGap
  const labelGap = a.subjectLabel.localeCompare(b.subjectLabel, 'hr')
  if (labelGap !== 0)
    return labelGap
  if (a.subjectId !== b.subjectId)
    return a.subjectId < b.subjectId ? -1 : 1
  return 0
}
