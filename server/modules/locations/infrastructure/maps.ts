import type { MapsPort, SuggestAddressesQuery } from '../maps-port'
import { LOCATION_ADDRESS_MAX_LENGTH } from '../../../../shared'
import { nodeEnv } from '../../../core/index'
import { createGoogleMaps, GOOGLE_ATTRIBUTION } from './google-maps'
import { navigationLink } from './navigation-link'
import { createNoneMaps } from './none-maps'

/** Stable reference the office e2e can pick and the Driver link can assert. */
export const FAKE_PLACE_REF = 'ChIJfakeDubrovnik'

const queries: SuggestAddressesQuery[] = []
let unavailable = false

/** E2E flips this. Production never reaches the fake. */
export function setTestMapsUnavailable(value: boolean): void {
  unavailable = value
}

/** The last lookup the fake saw. Tests assert the language and the text. */
export function lastTestMapsQuery(): SuggestAddressesQuery | null {
  return queries.at(-1) ?? null
}

export function createFakeMaps(): MapsPort {
  return {
    async suggestAddresses(query) {
      queries.push(query)
      if (unavailable)
        return { available: false }
      const suffix = ', Dubrovnik'
      const text = query.text.length + suffix.length <= LOCATION_ADDRESS_MAX_LENGTH
        ? `${query.text}${suffix}`
        : query.text
      return {
        available: true,
        attribution: GOOGLE_ATTRIBUTION,
        suggestions: [{
          text,
          provider: 'google',
          placeRef: FAKE_PLACE_REF,
        }],
      }
    },
    navigationLink,
  }
}

/**
 * Test always gets the fake, even when `MAPS=google` and a key are set.
 * `google` outside test uses Places. Anything else, including the default
 * `none`, answers unavailable. The link is the same in every mode.
 */
export function mapsForApp(env: {
  readonly MAPS: 'google' | 'none'
  readonly MAPS_API_KEY?: string | undefined
}): MapsPort {
  if (nodeEnv() === 'test')
    return createFakeMaps()
  if (env.MAPS === 'google') {
    if (env.MAPS_API_KEY === undefined)
      throw new Error('MAPS=google requires MAPS_API_KEY')
    return createGoogleMaps(env.MAPS_API_KEY)
  }
  return createNoneMaps()
}
