import { expect, it } from 'vitest'
import { OPERATIONAL_DAY_START_DEFAULT, operationalDateInTimeZone } from '../../../../shared'
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
