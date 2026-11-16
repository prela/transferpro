import { expect, it } from 'vitest'
import { addCalendarDays, flightDesignator, OPERATIONAL_DAY_START_DEFAULT, operationalDateInTimeZone, passengersExceedSeatCount } from '../../../../shared'
import { buildDemoPicture, DEMO_TIME_ZONE } from './demo-seed-picture'

/** Eighty characters, no spaces, so a 360px row can overflow on one run. */
const LONG_LOCATION_NAME = 'Izmišljenalokacijadugačkanazivbezrazmakaodaklejeredprelijevatelefonu360pxizmišlj'
const LONG_LOCATION_ADDRESS = 'Izmišljenaulicadugačkaadresabezrazmakaodaklejeredprelijevatelefonu360pxizmišljen'
const LONG_CLIENT_NAME = 'Izmišljeniklijentdugačkanazivbezrazmakaodaklejeredprelijevatelefonu360pxizmišlje'

/** The id the office E2E picks. The demo seed must not reuse it. */
const E2E_FAKE_PLACE_REF = 'ChIJfakeDubrovnik'

/**
 * The picture is the demo seed's Locations. The airport and the hotel
 * carry public place ids. The address-kind Location does not, and neither
 * id is the fake the E2E fixtures pick.
 */

it('gives the airport and the hotel public place ids, and the address none', () => {
  const picture = buildDemoPicture(new Date('2026-10-22T10:00:00.000Z'))
  const airport = picture.locations.find(location => location.key === 'airport')
  const hotel = picture.locations.find(location => location.key === 'hotel')
  const address = picture.locations.find(location => location.key === 'address')

  expect(airport?.kind).toBe('airport')
  expect(airport?.place).toEqual({
    provider: 'google',
    placeRef: 'ChIJ6YIGjkMSTBMR2VHFkRMhOCU',
  })
  expect(hotel?.kind).toBe('hotel')
  expect(hotel?.place).toEqual({
    provider: 'google',
    placeRef: 'ChIJ_62IVDULTBMRi7eaGcc6tGQ',
  })
  expect(address?.kind).toBe('address')
  expect(address?.place).toBeNull()

  const refs = picture.locations.map(location => location.place?.placeRef).filter(ref => ref !== undefined)
  expect(refs).not.toContain(E2E_FAKE_PLACE_REF)
  expect(airport?.place?.placeRef).not.toBe(airport?.address)
  expect(hotel?.place?.placeRef).not.toBe(hotel?.address)
})

/**
 * One address-kind Location and one Client carry a long unbroken name so
 * the office day list and driver A's phone list can show a 360px overflow.
 * The address keeps no place id. The picture stores no coordinates.
 */
it('puts a long fictional ride on driver A during the current operational day', () => {
  const now = new Date('2026-10-22T10:00:00.000Z')
  const picture = buildDemoPicture(now)
  const location = picture.locations.find(item => item.key === 'long')
  const client = picture.clients.find(item => item.key === 'long')
  const ride = picture.rides.find(item => item.start === 'long')
  const today = operationalDateInTimeZone(DEMO_TIME_ZONE, now, OPERATIONAL_DAY_START_DEFAULT)

  expect(location).toMatchObject({
    kind: 'address',
    name: LONG_LOCATION_NAME,
    address: LONG_LOCATION_ADDRESS,
    iata: null,
    place: null,
  })
  expect(location).not.toHaveProperty('lat')
  expect(location).not.toHaveProperty('lng')
  expect(client).toMatchObject({
    name: LONG_CLIENT_NAME,
    kind: 'agency',
  })
  expect(ride).toMatchObject({
    client: 'long',
    end: 'hotel',
    guestName: 'Gost Dugački',
    state: 'assigned',
    driver: 'a',
    vehicle: 'valid',
    mustAccept: false,
  })
  if (ride === undefined)
    throw new Error('The long ride is missing.')
  expect(operationalDateInTimeZone(DEMO_TIME_ZONE, ride.pickupAt, OPERATIONAL_DAY_START_DEFAULT)).toBe(today)
  expect([LONG_LOCATION_NAME, LONG_LOCATION_ADDRESS, LONG_CLIENT_NAME].every(text => text.length === 80 && !/\s/.test(text))).toBe(true)
})

/**
 * The operational day the office opens after this seed. Midday, the last
 * hour before the start hour, and both DST changes have to land on that
 * day rather than a fixed calendar date.
 */
const DEMO_CLOCKS = [
  '2026-06-15T10:00:00.000Z',
  '2026-06-15T02:30:00.000Z',
  '2026-03-29T00:30:00.000Z',
  '2026-10-25T00:30:00.000Z',
] as const

function operationalDay(instant: Date): string {
  return operationalDateInTimeZone(DEMO_TIME_ZONE, instant, OPERATIONAL_DAY_START_DEFAULT)
}

/**
 * #602. The picture is what `pnpm db:seed:demo` stores. These cases are
 * what Home, the day list, and driver A's phone have to show.
 */
it.each(DEMO_CLOCKS)('seeds a handoff, seats, an over-capacity ride, flights, and tomorrow at %s', (clock) => {
  const now = new Date(clock)
  const picture = buildDemoPicture(now)
  const today = operationalDay(now)
  const tomorrow = addCalendarDays(today, 1)
  const onDay = (pickupAt: Date, day: string) => operationalDay(pickupAt) === day

  expect(picture.vehicles.map(vehicle => vehicle.seatCount)).toEqual([4, 4, 4, 4])

  expect(picture.partners).toEqual([
    {
      key: 'carrier',
      id: 'd2170000-0000-4000-8000-000000000321',
      name: 'Prijevoznik Izmišljeni',
      phone: '555-0199',
      email: 'demo-partner@example.com',
    },
  ])

  const waiting = picture.rides.filter(ride => ride.state === 'handed_off' && ride.partnerConfirmed === false)
  const confirmed = picture.rides.filter(ride => ride.state === 'handed_off' && ride.partnerConfirmed === true)
  expect(waiting).toHaveLength(1)
  expect(confirmed).toHaveLength(1)
  expect(waiting[0]).toMatchObject({
    guestName: 'Gost Partner Čeka',
    partner: 'carrier',
    driver: null,
    vehicle: null,
    mustAccept: null,
  })
  expect(confirmed[0]).toMatchObject({
    guestName: 'Gost Partner Potvrda',
    partner: 'carrier',
    driver: null,
    vehicle: null,
    mustAccept: null,
  })
  const waitingRide = waiting[0]
  const confirmedRide = confirmed[0]
  if (waitingRide === undefined || confirmedRide === undefined)
    throw new Error('A handoff is missing.')
  expect(waitingRide.pickupAt.getTime()).toBeGreaterThanOrEqual(now.getTime())
  expect(onDay(waitingRide.pickupAt, tomorrow)).toBe(true)
  expect(onDay(confirmedRide.pickupAt, tomorrow)).toBe(true)

  const crowded = picture.rides.filter((ride) => {
    if (ride.vehicle === null)
      return false
    const seats = picture.vehicles.find(vehicle => vehicle.key === ride.vehicle)?.seatCount
    return passengersExceedSeatCount(ride.passengerCount, seats)
  })
  expect(crowded).toEqual([
    expect.objectContaining({
      guestName: 'Gost Previše',
      state: 'assigned',
      vehicle: 'valid',
      passengerCount: 6,
    }),
  ])
  expect(picture.vehicles.find(vehicle => vehicle.key === 'valid')?.seatCount).toBe(4)

  const main = picture.rides.find(ride => ride.guestName === 'Gost Skupina')
  const extra = picture.rides.find(ride => ride.guestName === 'Gost Skupina Extra')
  expect(main).toMatchObject({ groupPassengerCount: 6, linkTransferId: null, passengerCount: 4 })
  expect(extra).toMatchObject({
    groupPassengerCount: null,
    linkTransferId: main?.transferId,
    passengerCount: 2,
    price: '0.00',
  })

  const todayFlight = picture.rides.find(ride => ride.guestName === 'Gost Let Danas')
  const tomorrowFlight = picture.rides.find(ride => ride.guestName === 'Gost Let Sutra')
  expect(todayFlight).toMatchObject({ start: 'airport', flightNumber: 'ZZ 1101', airportMark: true })
  expect(tomorrowFlight).toMatchObject({ start: 'airport', flightNumber: 'ZZ 1202', airportMark: true })
  expect(flightDesignator('ZZ 1101')).toBe('ZZ1101')
  expect(flightDesignator('ZZ 1202')).toBe('ZZ1202')
  expect(flightDesignator('Let bez polaska')).toBeNull()
  if (todayFlight === undefined || tomorrowFlight === undefined)
    throw new Error('An airport arrival is missing.')
  expect(onDay(todayFlight.pickupAt, today)).toBe(true)
  expect(onDay(tomorrowFlight.pickupAt, tomorrow)).toBe(true)

  const tomorrowRides = picture.rides.filter(ride => onDay(ride.pickupAt, tomorrow))
  expect(tomorrowRides.some(ride => ride.state === 'assigned' && ride.mustAccept === false)).toBe(true)
  expect(tomorrowRides.some(ride => ride.state === 'unassigned' && ride.guestName === 'Gost Slobodno')).toBe(true)
  expect(tomorrowRides.some(ride => ride.driver === 'a' && ride.state === 'assigned' && ride.mustAccept === true && ride.guestName === 'Gost Prihvat Sutra')).toBe(true)

  const driverA = picture.rides.filter(ride => ride.driver === 'a' && (ride.state === 'assigned' || ride.state === 'accepted'))
  expect(driverA.length).toBeGreaterThan(1)
  expect(driverA.some(ride => ride.mustAccept === true && ride.pickupAt.getTime() > now.getTime())).toBe(true)

  expect(picture.rides.find(ride => ride.guestName === 'Gost Odbijen')).toMatchObject({ state: 'unassigned', declinedBy: 'a' })
  expect(picture.rides.find(ride => ride.guestName === 'Gost Prihvat')).toMatchObject({ state: 'assigned', driver: 'c', mustAccept: true })
  expect(picture.rides.find(ride => ride.guestName === 'Gost Uskoro')).toMatchObject({ state: 'unassigned', driver: null })
  expect(picture.members.map(member => member.driver)).toEqual([null, null, 'a', 'b', 'c'])
})
