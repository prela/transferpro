/**
 * Maps for Locations (ADR-0031). Domain and application code depend on this
 * port. Adapters live in infrastructure. The domain does not know a provider.
 */

export interface AddressSuggestion {
  readonly text: string
  readonly provider: string
  readonly placeRef: string
}

export type SuggestAddressesResult
  = | { readonly available: false }
    | {
      readonly available: true
      readonly suggestions: readonly AddressSuggestion[]
      readonly attribution: string
    }

/** What a navigation link is built from. The link itself is not stored. */
export interface NavigationTarget {
  readonly name: string
  readonly address: string | null
  readonly place: { readonly provider: string, readonly placeRef: string } | null
}

/**
 * What an Embed URL is built from. The URL is not stored (ADR-0052).
 * The name and the address are on the target so a test can show the URL
 * was not built from them. An archived Location has no map.
 */
export interface EmbedTarget {
  readonly name: string
  readonly address: string | null
  readonly archivedAt: string | null
  readonly place: { readonly provider: string, readonly placeRef: string } | null
}

/**
 * An active Location with a stored `google` reference. Anything else has
 * no Embed URL, including a hand-typed address and another provider.
 */
export function embeddable(target: EmbedTarget): target is EmbedTarget & {
  readonly place: { readonly provider: string, readonly placeRef: string }
} {
  if (target.archivedAt !== null)
    return false
  const place = target.place
  return place !== null && place.provider === 'google' && place.placeRef !== ''
}

export interface SuggestAddressesQuery {
  readonly text: string
  readonly sessionToken: string
  readonly language: string
}

/**
 * One free check of a stored place reference (ADR-0052).
 * `same` is the id we asked about. `replaced` is a different id Google
 * still finds. `gone` is `NOT_FOUND` only. Everything else, including an
 * invalid id, is `unavailable` and must not be treated as a clear.
 */
export type PlaceReferenceCheck
  = { readonly outcome: 'same' }
    | { readonly outcome: 'replaced', readonly placeRef: string }
    | { readonly outcome: 'gone' }
    | { readonly outcome: 'unavailable' }

/**
 * Suggest addresses, or say the provider is unavailable.
 * Build a navigation link for a Location. The link calls nothing.
 * Build an Embed URL for a Location and a language, or say there is none.
 * That URL calls nothing (ADR-0052).
 * Check one stored reference. Nothing in the office calls this yet.
 */
export interface MapsPort {
  suggestAddresses: (query: SuggestAddressesQuery) => Promise<SuggestAddressesResult>
  navigationLink: (target: NavigationTarget) => string
  embedUrl: (target: EmbedTarget, language: string) => string | null
  checkPlaceRef: (placeRef: string) => Promise<PlaceReferenceCheck>
}
