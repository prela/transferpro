import type { MapsPort, PlaceReferenceCheck, SuggestAddressesQuery } from '../maps-port'
import { LOCATION_ADDRESS_MAX_LENGTH } from '../../../../shared'
import { nodeEnv } from '../../../core/index'
import { embeddable } from '../maps-port'
import { createGoogleMaps, GOOGLE_ATTRIBUTION } from './google-maps'
import { navigationLink } from './navigation-link'
import { createNoneMaps } from './none-maps'

/** Stable reference the office e2e can pick and the Driver link can assert. */
export const FAKE_PLACE_REF = 'ChIJfakeDubrovnik'

const queries: SuggestAddressesQuery[] = []
let unavailable = false
let embedOff = false
let placeReferenceCheck: PlaceReferenceCheck = { outcome: 'unavailable' }
const checkedPlaceRefs: string[] = []

/**
 * Unit tests flip this. Production never reaches the fake.
 * E2E must not: every worker shares this process, so one spec would
 * turn suggestions back on while another still expects them off.
 * That switch is `TEST_SUGGESTIONS_UNAVAILABLE_COOKIE` on the caller.
 */
export function setTestMapsUnavailable(value: boolean): void {
  unavailable = value
}

/** Cookie the suggestions-mode route sets. Read only while `NODE_ENV` is test. */
export const TEST_SUGGESTIONS_UNAVAILABLE_COOKIE = 'tp-test-suggestions-unavailable'

/**
 * True when this caller's cookie asks the fake to answer unavailable.
 * Absent, or any environment other than test, leaves the lookup alone,
 * so a browser cannot switch a real provider by sending the cookie.
 */
export function testSuggestionsForcedOff(cookieHeader: string | null): boolean {
  if (nodeEnv() !== 'test' || cookieHeader === null)
    return false
  const mark = `${TEST_SUGGESTIONS_UNAVAILABLE_COOKIE}=1`
  return cookieHeader.split(';').some(part => part.trim() === mark)
}

/**
 * Unit and route tests turn the fake Embed off.
 * Production never reaches the fake, and the route that calls this is
 * 404 outside test (ADR-0052). E2E leaves the flag alone.
 */
export function setTestMapsEmbedOff(value: boolean): void {
  embedOff = value
}

/** The last lookup the fake saw. Tests assert the language and the text. */
export function lastTestMapsQuery(): SuggestAddressesQuery | null {
  return queries.at(-1) ?? null
}

/**
 * The next `checkPlaceRef` answer. Production never reaches the fake.
 * The default is unavailable, so an unset test does not look like a clear.
 */
export function setTestPlaceReferenceCheck(value: PlaceReferenceCheck): void {
  placeReferenceCheck = value
}

/** The last reference the fake was asked to check. */
export function lastTestPlaceReference(): string | null {
  return checkedPlaceRefs.at(-1) ?? null
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
    embedUrl(target, language) {
      // about:blank so a test page never loads Google. The fragment carries
      // the reference and the language, and not the address, the name, or a
      // key. The e2e server keeps its own MAPS config, often `none` and no
      // Embed key. This fake still yields a URL. Production does not use it
      // (ADR-0052): outside test, `none` or a missing key means no URL.
      if (embedOff || !embeddable(target))
        return null
      const fragment = new URLSearchParams({
        placeRef: target.place.placeRef,
        language,
      })
      return `about:blank#${fragment.toString()}`
    },
    async checkPlaceRef(placeRef) {
      checkedPlaceRefs.push(placeRef)
      return placeReferenceCheck
    },
  }
}

/**
 * Test always gets the fake, even when `MAPS=google` and a key are set.
 * `google` outside test uses Places. Anything else, including the default
 * `none`, answers unavailable. The link is the same in every mode.
 * Outside test, the Embed URL needs `MAPS=google` and `MAPS_EMBED_KEY`.
 * Either one missing means there is no URL (ADR-0052). In test the fake
 * yields an about:blank URL for an embeddable Location and never calls
 * Google, including when MAPS is `none` and no Embed key is set.
 */
export function mapsForApp(env: {
  readonly MAPS: 'google' | 'none'
  readonly MAPS_API_KEY?: string | undefined
  readonly MAPS_EMBED_KEY?: string | undefined
}): MapsPort {
  if (nodeEnv() === 'test')
    return createFakeMaps()
  if (env.MAPS === 'google') {
    if (env.MAPS_API_KEY === undefined)
      throw new Error('MAPS=google requires MAPS_API_KEY')
    return createGoogleMaps(env.MAPS_API_KEY, undefined, env.MAPS_EMBED_KEY)
  }
  return createNoneMaps()
}
