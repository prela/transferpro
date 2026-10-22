import type { PaymentMethod, RideState } from '../../../../shared'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, localDayBounds, OPERATIONAL_DAY_START_DEFAULT, operationalDateInTimeZone, TENANT_TIME_ZONE_DEFAULT } from '../../../../shared'

/**
 * The fictional demo Tenant, rebuilt from the clock each run.
 * Instants are derived in Europe/Zagreb. No calendar date is written
 * as a literal. Ids stay the same across runs so a bookmark still resolves.
 * Names, plates, and addresses are obviously fictional. The airport code
 * ZZZ is not a scheduled airport, and flight text is not a designator,
 * so a later status ask has nothing to call.
 * The airport and the hotel store public Google place ids so a preview
 * map resolves. Those ids are not the fictional address text. The
 * address-kind Location has none (ADR-0052).
 */

export const DEMO_SLUG = 'demo'
export const DEMO_TENANT_NAME = 'Izmišljeni prijevoz'
export const DEMO_TIME_ZONE = TENANT_TIME_ZONE_DEFAULT

/** Last valid day for every document except the one expired registration. */
const DOCUMENT_VALID_DAYS = 400

export type DemoMemberKey = 'admin' | 'dispatcher' | 'driver-a' | 'driver-b' | 'driver-c'
export type DemoDriverKey = 'a' | 'b' | 'c'
export type DemoVehicleKey = 'valid' | 'expired' | 'archived' | 'gap'
export type DemoClientKey = 'agency' | 'hotel' | 'individual'
export type DemoLocationKey = 'airport' | 'hotel' | 'address'

export interface DemoMember {
  readonly key: DemoMemberKey
  readonly userId: string
  readonly memberId: string
  readonly accountId: string
  readonly email: string
  readonly name: string
  readonly role: 'admin' | 'dispatcher' | 'driver'
  readonly driver: DemoDriverKey | null
  readonly phone: string | null
  readonly mustAccept: boolean
}

export interface DemoClient {
  readonly key: DemoClientKey
  readonly id: string
  readonly name: string
  readonly kind: DemoClientKey
}

export interface DemoLocation {
  readonly key: DemoLocationKey
  readonly id: string
  readonly name: string
  readonly kind: DemoLocationKey
  readonly address: string
  readonly iata: string | null
  /** A public Google place, or null. Never set on an address-kind Location. */
  readonly place: { readonly provider: 'google', readonly placeRef: string } | null
}

export interface DemoVehicle {
  readonly key: DemoVehicleKey
  readonly id: string
  readonly plate: string
  readonly archived: boolean
}

export interface DemoRide {
  readonly transferId: string
  readonly rideId: string
  readonly alertId: string | null
  readonly client: DemoClientKey
  readonly pickupAt: Date
  readonly start: DemoLocationKey
  readonly end: DemoLocationKey
  readonly guestName: string
  readonly flightNumber: string | null
  readonly landingAt: Date | null
  readonly price: string
  readonly payment: PaymentMethod
  readonly airportMark: boolean
  readonly note: string | null
  readonly tabla: string
  readonly state: RideState
  readonly driver: DemoDriverKey | null
  readonly vehicle: DemoVehicleKey | null
  readonly mustAccept: boolean | null
  /** The driver named on a decline alert. The Ride itself stays unassigned. */
  readonly declinedBy: DemoDriverKey | null
}

export interface DemoRosterRow {
  readonly id: string
  readonly rosterDate: string
  readonly driver: DemoDriverKey
  readonly vehicle: DemoVehicleKey
}

export interface DemoPicture {
  readonly tenantId: string
  readonly members: readonly DemoMember[]
  readonly clients: readonly DemoClient[]
  readonly locations: readonly DemoLocation[]
  readonly vehicles: readonly DemoVehicle[]
  readonly rides: readonly DemoRide[]
  readonly roster: readonly DemoRosterRow[]
  readonly driverIds: Readonly<Record<DemoDriverKey, string>>
  /** Last valid day of the registration that the expired ride uses. */
  readonly registrationExpiredOn: string
  /** Technical, insurance, and every licence. Well past the seeded week. */
  readonly documentsValidOn: string
  readonly archivedAt: Date
}

function demoId(n: number): string {
  return `d2170000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

const MINUTE = 60_000

/**
 * How far the last cluster pickup sits after the first, in minutes.
 * The cluster has to finish before the next operational-day start.
 */
const CLUSTER_SPAN_MINUTES = 420

function member(
  key: DemoMemberKey,
  user: number,
  membership: number,
  account: number,
  email: string,
  name: string,
  role: DemoMember['role'],
  driver: DemoDriverKey | null,
  phone: string | null,
  mustAccept: boolean,
): DemoMember {
  return {
    key,
    userId: demoId(user),
    memberId: demoId(membership),
    accountId: demoId(account),
    email,
    name,
    role,
    driver,
    phone,
    mustAccept,
  }
}

const members: readonly DemoMember[] = [
  member('admin', 11, 21, 31, 'demo-admin@example.com', 'Admin Izmišljeni', 'admin', null, null, false),
  member('dispatcher', 12, 22, 32, 'demo-dispatcher@example.com', 'Dispečer Izmišljeni', 'dispatcher', null, null, false),
  member('driver-a', 13, 23, 33, 'demo-driver-a@example.com', 'Vozač Izmišljeni A', 'driver', 'a', '555-0100', false),
  member('driver-b', 14, 24, 34, 'demo-driver-b@example.com', 'Vozač Izmišljeni B', 'driver', 'b', '555-0101', false),
  member('driver-c', 15, 25, 35, 'demo-driver-c@example.com', 'Vozač Izmišljeni C', 'driver', 'c', '555-0102', true),
]

const clients: readonly DemoClient[] = [
  { key: 'agency', id: demoId(101), name: 'Agencija Izmišljena', kind: 'agency' },
  { key: 'hotel', id: demoId(102), name: 'Hotel Izmišljeni', kind: 'hotel' },
  { key: 'individual', id: demoId(103), name: 'Osoba Izmišljena', kind: 'individual' },
]

const locations: readonly DemoLocation[] = [
  {
    key: 'airport',
    id: demoId(201),
    name: 'Zračna luka Izmišljena',
    kind: 'airport',
    address: 'Obala Izmišljena 1',
    iata: 'ZZZ',
    // Dubrovnik Airport (DBV), Dobrota 24, Močići. A public place.
    place: { provider: 'google', placeRef: 'ChIJ6YIGjkMSTBMR2VHFkRMhOCU' },
  },
  {
    key: 'hotel',
    id: demoId(202),
    name: 'Hotel Izmišljeni',
    kind: 'hotel',
    address: 'Ulica Izmišljena 10',
    iata: null,
    // Hotel Excelsior, Ul. Frana Supila 12, Dubrovnik. A public place.
    place: { provider: 'google', placeRef: 'ChIJ_62IVDULTBMRi7eaGcc6tGQ' },
  },
  {
    key: 'address',
    id: demoId(203),
    name: 'Kuća Izmišljena',
    kind: 'address',
    address: 'Trg Izmišljeni 2',
    iata: null,
    place: null,
  },
]

const vehicles: readonly DemoVehicle[] = [
  { key: 'valid', id: demoId(301), plate: 'IZM001', archived: false },
  { key: 'expired', id: demoId(302), plate: 'IZM002', archived: false },
  { key: 'archived', id: demoId(303), plate: 'IZM003', archived: true },
  { key: 'gap', id: demoId(304), plate: 'IZM004', archived: false },
]

export function buildDemoPicture(now: Date): DemoPicture {
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Instant is not a valid time.')

  const zone = DEMO_TIME_ZONE
  const opDay = operationalDateInTimeZone(zone, now, OPERATIONAL_DAY_START_DEFAULT)
  const bounds = localDayBounds(opDay, zone, OPERATIONAL_DAY_START_DEFAULT)
  const previous = localDayBounds(addCalendarDays(opDay, -1), zone, OPERATIONAL_DAY_START_DEFAULT)
  const twoDaysAgo = localDayBounds(addCalendarDays(opDay, -2), zone, OPERATIONAL_DAY_START_DEFAULT)
  const twoDaysAhead = localDayBounds(addCalendarDays(opDay, 2), zone, OPERATIONAL_DAY_START_DEFAULT)
  const start = clusterStart(now, opDay, bounds.end)
  const at = (minutes: number) => new Date(start.getTime() + minutes * MINUTE)

  const expiredPickup = at(100)
  const mismatchPickup = at(340)
  const registrationExpiredOn = addCalendarDays(calendarDateInTimeZone(zone, expiredPickup), -1)
  const documentsValidOn = addCalendarDays(calendarDateInTimeZone(zone, now), DOCUMENT_VALID_DAYS)

  const rides: DemoRide[] = [
    // In progress on the gap car, so this pickup does not share the valid car's
    // roster day. Landed long enough for the landing alarm, and past the unclosed mark.
    ride(1, {
      client: 'agency',
      pickupAt: new Date(now.getTime() - 90 * MINUTE),
      start: 'airport',
      end: 'hotel',
      guestName: 'Gost Slijetanje',
      flightNumber: 'Let bez polaska',
      landingAt: new Date(now.getTime() - 3 * 60 * MINUTE),
      price: '18.00',
      payment: 'cash',
      note: null,
      tabla: 'GOST',
      state: 'assigned',
      driver: 'a',
      vehicle: 'gap',
      mustAccept: false,
    }),
    // In progress, no flight and no landing, already past the unclosed mark.
    ride(2, {
      client: 'hotel',
      pickupAt: new Date(now.getTime() - 70 * MINUTE),
      start: 'hotel',
      end: 'address',
      guestName: 'Gost Nezatvoreno',
      flightNumber: null,
      landingAt: null,
      price: '22.50',
      payment: 'card',
      note: null,
      tabla: '',
      state: 'assigned',
      driver: 'b',
      vehicle: 'gap',
      mustAccept: false,
    }),
    ride(3, {
      client: 'individual',
      pickupAt: new Date(now.getTime() + 2 * 60 * MINUTE),
      start: 'address',
      end: 'airport',
      guestName: 'Gost Uskoro',
      flightNumber: null,
      landingAt: null,
      price: '15.00',
      payment: 'cash',
      note: null,
      tabla: '',
      state: 'unassigned',
      driver: null,
      vehicle: null,
      mustAccept: null,
    }),
    ride(4, {
      client: 'agency',
      pickupAt: new Date(now.getTime() - 30 * MINUTE),
      start: 'hotel',
      end: 'address',
      guestName: 'Gost Odbijen',
      flightNumber: null,
      landingAt: null,
      price: '19.00',
      payment: 'card',
      note: null,
      tabla: '',
      state: 'unassigned',
      driver: null,
      vehicle: null,
      mustAccept: null,
      declinedBy: 'a',
    }),
    ride(5, {
      client: 'individual',
      pickupAt: new Date(now.getTime() + 5 * 60 * MINUTE),
      start: 'address',
      end: 'hotel',
      guestName: 'Gost Kasnije',
      flightNumber: null,
      landingAt: null,
      price: '12.00',
      payment: 'invoice_to_agency',
      note: null,
      tabla: '',
      state: 'unassigned',
      driver: null,
      vehicle: null,
      mustAccept: null,
    }),
    // Same driver, windows share an instant. Accepted, so the copy of must-accept is true.
    ride(6, {
      client: 'agency',
      pickupAt: at(0),
      start: 'airport',
      end: 'hotel',
      guestName: 'Gost Preklop A',
      flightNumber: null,
      landingAt: null,
      price: '25.00',
      payment: 'cash',
      note: null,
      tabla: '',
      state: 'accepted',
      driver: 'c',
      vehicle: 'gap',
      mustAccept: true,
    }),
    ride(7, {
      client: 'hotel',
      pickupAt: at(20),
      start: 'hotel',
      end: 'address',
      guestName: 'Gost Preklop B',
      flightNumber: null,
      landingAt: null,
      price: '25.00',
      payment: 'card',
      note: null,
      tabla: '',
      state: 'accepted',
      driver: 'c',
      vehicle: 'gap',
      mustAccept: true,
    }),
    // Waiting on acceptance. The gap car is free again, so this is not a second overlap.
    ride(8, {
      client: 'individual',
      pickupAt: at(100),
      start: 'address',
      end: 'hotel',
      guestName: 'Gost Prihvat',
      flightNumber: null,
      landingAt: null,
      price: '30.00',
      payment: 'invoice_to_agency',
      note: null,
      tabla: '',
      state: 'assigned',
      driver: 'c',
      vehicle: 'gap',
      mustAccept: true,
    }),
    // Registration expired the calendar day before this pickup. The roster names this driver.
    ride(9, {
      client: 'agency',
      pickupAt: expiredPickup,
      start: 'hotel',
      end: 'airport',
      guestName: 'Gost Registracija',
      flightNumber: null,
      landingAt: null,
      price: '16.00',
      payment: 'card',
      note: null,
      tabla: '',
      state: 'assigned',
      driver: 'a',
      vehicle: 'expired',
      mustAccept: false,
    }),
    // Same car as the overlap pair, different drivers, ten minutes of gap.
    ride(10, {
      client: 'hotel',
      pickupAt: at(180),
      start: 'hotel',
      end: 'address',
      guestName: 'Gost Tijesno A',
      flightNumber: null,
      landingAt: null,
      price: '21.00',
      payment: 'invoice_to_agency',
      note: null,
      tabla: '',
      state: 'accepted',
      driver: 'a',
      vehicle: 'gap',
      mustAccept: true,
    }),
    ride(11, {
      client: 'agency',
      pickupAt: at(250),
      start: 'address',
      end: 'hotel',
      guestName: 'Gost Tijesno B',
      flightNumber: null,
      landingAt: null,
      price: '21.00',
      payment: 'cash',
      note: null,
      tabla: '',
      state: 'accepted',
      driver: 'b',
      vehicle: 'gap',
      mustAccept: true,
    }),
    // The roster gives this car to driver C. The Ride is driver B. Documents are valid.
    ride(12, {
      client: 'individual',
      pickupAt: mismatchPickup,
      start: 'address',
      end: 'airport',
      guestName: 'Gost Raspored',
      flightNumber: null,
      landingAt: null,
      price: '28.00',
      payment: 'invoice_to_agency',
      note: null,
      tabla: '',
      state: 'assigned',
      driver: 'b',
      vehicle: 'valid',
      mustAccept: false,
    }),
    ride(13, {
      client: 'agency',
      pickupAt: at(420),
      start: 'airport',
      end: 'address',
      guestName: 'Gost Let',
      flightNumber: 'Izmišljeni let',
      landingAt: null,
      price: '35.00',
      payment: 'cash',
      note: 'Doček na izlazu',
      tabla: 'GOST',
      state: 'assigned',
      driver: 'a',
      vehicle: 'gap',
      mustAccept: false,
    }),
    ride(14, {
      client: 'hotel',
      pickupAt: new Date(previous.start.getTime() + 2 * 60 * MINUTE),
      start: 'hotel',
      end: 'address',
      guestName: 'Gost Gotovo',
      flightNumber: null,
      landingAt: null,
      price: '14.00',
      payment: 'card',
      note: null,
      tabla: '',
      state: 'done',
      driver: 'a',
      vehicle: 'archived',
      mustAccept: false,
    }),
    ride(15, {
      client: 'individual',
      pickupAt: new Date(previous.start.getTime() + 4 * 60 * MINUTE),
      start: 'address',
      end: 'hotel',
      guestName: 'Gost Izostanak',
      flightNumber: null,
      landingAt: null,
      price: '11.00',
      payment: 'invoice_to_agency',
      note: null,
      tabla: '',
      state: 'no-show',
      driver: 'b',
      vehicle: 'valid',
      mustAccept: false,
    }),
    ride(16, {
      client: 'agency',
      pickupAt: new Date(previous.start.getTime() + 6 * 60 * MINUTE),
      start: 'airport',
      end: 'hotel',
      guestName: 'Gost Otkazano',
      flightNumber: 'Let otkazan',
      landingAt: null,
      price: '10.00',
      payment: 'cash',
      note: null,
      tabla: '',
      state: 'cancelled',
      driver: 'c',
      vehicle: 'gap',
      mustAccept: true,
    }),
    ride(17, {
      client: 'hotel',
      pickupAt: new Date(twoDaysAgo.start.getTime() + 3 * 60 * MINUTE),
      start: 'hotel',
      end: 'airport',
      guestName: 'Gost Prije',
      flightNumber: null,
      landingAt: null,
      price: '13.00',
      payment: 'card',
      note: null,
      tabla: '',
      state: 'done',
      driver: 'b',
      vehicle: 'valid',
      mustAccept: false,
    }),
    ride(18, {
      client: 'individual',
      pickupAt: new Date(twoDaysAhead.start.getTime() + 5 * 60 * MINUTE),
      start: 'address',
      end: 'hotel',
      guestName: 'Gost Prekosutra',
      flightNumber: null,
      landingAt: null,
      price: '17.00',
      payment: 'cash',
      note: null,
      tabla: '',
      state: 'unassigned',
      driver: null,
      vehicle: null,
      mustAccept: null,
    }),
  ]

  return {
    tenantId: demoId(1),
    members,
    clients,
    locations,
    vehicles,
    rides,
    roster: [
      {
        id: demoId(701),
        rosterDate: calendarDateInTimeZone(zone, expiredPickup),
        driver: 'a',
        vehicle: 'expired',
      },
      {
        id: demoId(702),
        rosterDate: calendarDateInTimeZone(zone, mismatchPickup),
        driver: 'c',
        vehicle: 'valid',
      },
    ],
    driverIds: {
      a: demoId(111),
      b: demoId(112),
      c: demoId(113),
    },
    registrationExpiredOn,
    documentsValidOn,
    archivedAt: now,
  }
}

/**
 * Prefer a cluster that still fits on the operational day the clock is in.
 * When the last pickup would fall after the next start hour, the whole
 * cluster moves to 08:00 on the next operational day. Home still shows an
 * in-progress Ride from the previous day, and an unassigned alarm that
 * crossed the start hour stays inside four hours because it is two hours ahead.
 */
function clusterStart(now: Date, opDay: string, opEnd: Date): Date {
  const morning = instantFromWallClock(`${opDay}T08:00`, DEMO_TIME_ZONE)
  const earliest = Math.max(now.getTime() + 20 * MINUTE, morning.getTime())
  if (earliest + CLUSTER_SPAN_MINUTES * MINUTE < opEnd.getTime())
    return new Date(earliest)
  return instantFromWallClock(`${addCalendarDays(opDay, 1)}T08:00`, DEMO_TIME_ZONE)
}

function ride(
  n: number,
  row: Omit<DemoRide, 'transferId' | 'rideId' | 'alertId' | 'airportMark' | 'declinedBy'> & { declinedBy?: DemoDriverKey },
): DemoRide {
  const { declinedBy, ...rest } = row
  return {
    ...rest,
    transferId: demoId(400 + n),
    rideId: demoId(500 + n),
    alertId: declinedBy === undefined ? null : demoId(600 + n),
    airportMark: rest.start === 'airport',
    declinedBy: declinedBy ?? null,
  }
}
