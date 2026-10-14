import type { NavigationTarget } from '../maps-port'

/**
 * v1 opens directions with a Google Maps URL in every `MAPS` mode.
 * The URL needs no key and this function calls nothing (ADR-0031).
 * Google still requires a destination string beside `destination_place_id`,
 * so the text is the address when there is one, otherwise the name.
 * A reference is added only when its provider is this link adapter.
 */
const LINK_PROVIDER = 'google'

export function navigationLink(target: NavigationTarget): string {
  const destination = target.address ?? target.name
  const params = new URLSearchParams({
    api: '1',
    destination,
  })
  if (target.place !== null && target.place.provider === LINK_PROVIDER && target.place.placeRef !== '')
    params.set('destination_place_id', target.place.placeRef)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
