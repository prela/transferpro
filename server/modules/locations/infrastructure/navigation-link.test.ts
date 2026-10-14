import { expect, it } from 'vitest'
import { navigationLink } from './navigation-link'

const placeRef = 'ChIJ68aBlEKuEmsRHUA9oME5Zh0'

it('prefers a matching place reference over the address, and the address over the name', () => {
  const url = navigationLink({
    name: 'Hotel & Spa',
    address: 'Put 1, Čilipi',
    place: { provider: 'google', placeRef },
  })
  const parsed = new URL(url)
  expect(`${parsed.origin}${parsed.pathname}`).toBe('https://www.google.com/maps/dir/')
  expect(parsed.searchParams.get('api')).toBe('1')
  expect(parsed.searchParams.get('destination')).toBe('Put 1, Čilipi')
  expect(parsed.searchParams.get('destination_place_id')).toBe(placeRef)
  expect(parsed.searchParams.get('destination')).not.toBe('Hotel & Spa')
  expect(url).not.toContain('Hotel & Spa')
  expect(url).not.toContain('key=')
})

it('uses the address when the reference is from another provider', () => {
  const url = navigationLink({
    name: 'Hotel Excelsior',
    address: 'Frana Supila 12',
    place: { provider: 'photon', placeRef },
  })
  const parsed = new URL(url)
  expect(parsed.searchParams.get('destination')).toBe('Frana Supila 12')
  expect(parsed.searchParams.has('destination_place_id')).toBe(false)
  expect(url).not.toContain(placeRef)
})

it('uses the name when there is no address, and encodes the text', () => {
  const url = navigationLink({
    name: 'Hotel & Spa',
    address: null,
    place: null,
  })
  const parsed = new URL(url)
  expect(parsed.searchParams.get('destination')).toBe('Hotel & Spa')
  expect(url).toContain('Hotel+%26+Spa')
  expect(url).not.toContain('Hotel & Spa')
})

it('keeps a matching reference when the only text is the name', () => {
  const url = navigationLink({
    name: 'Zračna luka Dubrovnik',
    address: null,
    place: { provider: 'google', placeRef },
  })
  const parsed = new URL(url)
  expect(parsed.searchParams.get('destination')).toBe('Zračna luka Dubrovnik')
  expect(parsed.searchParams.get('destination_place_id')).toBe(placeRef)
})
