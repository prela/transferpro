import { expect, it } from 'vitest'
import { buildDemoPicture } from './demo-seed-picture'

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
