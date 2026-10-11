import type { Driver } from './driver'
import type { ExpiringDocument } from './expiring-documents'
import type { Vehicle } from './vehicle'
import { expect, it } from 'vitest'
import { calendarDateInTimeZone } from './date'
import { addCalendarDays, selectExpiringDocuments } from './expiring-documents'

/**
 * Worked window around 5 Oct 2026, counted as calendar days, not 30×24h.
 * 5 Oct + 30 days is 4 Nov (26 days left in October, then 4 in November).
 * 5 Nov is the first day outside the window.
 */
const today = '2026-10-05'
const lastIncluded = '2026-11-04'
const firstExcluded = '2026-11-05'

const phone = '+385911110000'
const anaId = '11111111-1111-4111-8111-111111111111'
const borisId = '22222222-2222-4222-8222-222222222222'
const liveId = '33333333-3333-4333-8333-333333333333'
const archivedId = '44444444-4444-4444-8444-444444444444'
const anaMember = '55555555-5555-4555-8555-555555555555'
const borisMember = '66666666-6666-4666-8666-666666666666'
const officeUser = '77777777-7777-4777-8777-777777777777'

function driver(overrides: Pick<Driver, 'id' | 'name' | 'memberUserId' | 'drivingLicenceExpiresOn' | 'transportLicenceExpiresOn'>): Driver {
  return {
    kind: 'own',
    phone,
    email: null,
    mustAccept: false,
    ...overrides,
  }
}

function vehicle(overrides: Pick<Vehicle, 'id' | 'registrationPlate' | 'archivedAt' | 'registrationExpiresOn' | 'technicalInspectionExpiresOn' | 'insuranceExpiresOn'>): Vehicle {
  return {
    kind: 'fixed',
    description: null,
    ...overrides,
  }
}

const ana = driver({
  id: anaId,
  name: 'Ana Horvat',
  memberUserId: anaMember,
  drivingLicenceExpiresOn: '2026-10-04',
  transportLicenceExpiresOn: lastIncluded,
})

const boris = driver({
  id: borisId,
  name: 'Boris Kovač',
  memberUserId: borisMember,
  drivingLicenceExpiresOn: '2000-01-01',
  transportLicenceExpiresOn: firstExcluded,
})

const live = vehicle({
  id: liveId,
  registrationPlate: 'ZG200BB',
  archivedAt: null,
  registrationExpiresOn: today,
  technicalInspectionExpiresOn: firstExcluded,
  insuranceExpiresOn: '2026-10-04',
})

const archived = vehicle({
  id: archivedId,
  registrationPlate: 'ZG999ZZ',
  archivedAt: '2026-09-01T00:00:00.000Z',
  registrationExpiresOn: '2000-01-01',
  technicalInspectionExpiresOn: '2000-01-01',
  insuranceExpiresOn: '2000-01-01',
})

const officeDocuments: ExpiringDocument[] = [
  { subject: 'driver', subjectId: borisId, subjectLabel: 'Boris Kovač', kind: 'driving_licence', expiresOn: '2000-01-01', status: 'expired' },
  { subject: 'driver', subjectId: anaId, subjectLabel: 'Ana Horvat', kind: 'driving_licence', expiresOn: '2026-10-04', status: 'expired' },
  { subject: 'vehicle', subjectId: liveId, subjectLabel: 'ZG200BB', kind: 'insurance', expiresOn: '2026-10-04', status: 'expired' },
  { subject: 'vehicle', subjectId: liveId, subjectLabel: 'ZG200BB', kind: 'vehicle_registration', expiresOn: today, status: 'expiring' },
  { subject: 'driver', subjectId: anaId, subjectLabel: 'Ana Horvat', kind: 'transport_licence', expiresOn: lastIncluded, status: 'expiring' },
]

it('reads the calendar day in the tenant time zone', () => {
  // 15 Jan 2026 23:30 UTC is 16 Jan in Europe/Zagreb (CET). The same instant
  // is still 15 Jul in New York when the summer instant is used below.
  const winterUtc = new Date('2026-01-15T23:30:00.000Z')
  const summerUtc = new Date('2026-07-15T22:30:00.000Z')
  expect(calendarDateInTimeZone('Europe/Zagreb', winterUtc)).toBe('2026-01-16')
  expect(calendarDateInTimeZone('Europe/Zagreb', summerUtc)).toBe('2026-07-16')
  expect(calendarDateInTimeZone('America/New_York', summerUtc)).toBe('2026-07-15')
  expect(calendarDateInTimeZone('UTC', winterUtc)).toBe('2026-01-15')
})

it('refuses an invalid instant or time zone', () => {
  expect(() => calendarDateInTimeZone('Europe/Zagreb', new Date('not-a-time'))).toThrow(RangeError)
  expect(() => calendarDateInTimeZone('Not/AZone', new Date('2026-10-05T12:00:00.000Z'))).toThrow(RangeError)
})

it('adds calendar days across month ends and a leap day', () => {
  expect(addCalendarDays('2026-10-05', 30)).toBe('2026-11-04')
  expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01')
  expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29')
  expect(addCalendarDays('2026-12-15', 30)).toBe('2027-01-14')
})

it('lists office documents that are expired or due within 30 days, expired first', () => {
  const listed = selectExpiringDocuments({
    role: 'admin',
    userId: officeUser,
    today,
    drivers: [ana, boris],
    vehicles: [archived, live],
  })
  expect(listed).toEqual(officeDocuments)
  expect(JSON.stringify(listed)).not.toContain(phone)
  expect(JSON.stringify(listed)).not.toContain('ZG999ZZ')
  expect(listed.map(document => document.expiresOn)).not.toContain(firstExcluded)
})

it('gives a dispatcher the same office list', () => {
  expect(selectExpiringDocuments({
    role: 'dispatcher',
    userId: anaMember,
    today,
    drivers: [boris, ana],
    vehicles: [live, archived],
  })).toEqual(officeDocuments)
})

it('shows a driver only their own linked licences', () => {
  expect(selectExpiringDocuments({
    role: 'driver',
    userId: anaMember,
    today,
    drivers: [boris, ana],
    vehicles: [live, archived],
  })).toEqual([
    { subject: 'driver', subjectId: anaId, subjectLabel: 'Ana Horvat', kind: 'driving_licence', expiresOn: '2026-10-04', status: 'expired' },
    { subject: 'driver', subjectId: anaId, subjectLabel: 'Ana Horvat', kind: 'transport_licence', expiresOn: lastIncluded, status: 'expiring' },
  ])
})

it('shows nothing when the signed-in driver has no linked Driver', () => {
  expect(selectExpiringDocuments({
    role: 'driver',
    userId: officeUser,
    today,
    drivers: [ana, boris],
    vehicles: [live],
  })).toEqual([])
})

it('orders two expired licences by name when the day is the same', () => {
  const earlier: Driver = { ...boris, name: 'Ana Horvat', drivingLicenceExpiresOn: '2000-01-01' }
  const later: Driver = { ...ana, name: 'Boris Kovač', drivingLicenceExpiresOn: '2000-01-01', transportLicenceExpiresOn: '2099-01-01' }
  const listed = selectExpiringDocuments({
    role: 'admin',
    userId: officeUser,
    today,
    drivers: [later, earlier],
    vehicles: [],
  })
  expect(listed.map(document => document.subjectLabel)).toEqual(['Ana Horvat', 'Boris Kovač'])
})
