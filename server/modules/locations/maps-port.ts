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

export interface SuggestAddressesQuery {
  readonly text: string
  readonly sessionToken: string
  readonly language: string
}

/**
 * Suggest addresses, or say the provider is unavailable.
 * Build a navigation link for a Location. The link calls nothing.
 */
export interface MapsPort {
  suggestAddresses: (query: SuggestAddressesQuery) => Promise<SuggestAddressesResult>
  navigationLink: (target: NavigationTarget) => string
}
