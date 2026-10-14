import type { MapsPort, SuggestAddressesResult } from '../maps-port'
import { z } from 'zod'
import { LOCATION_ADDRESS_MAX_LENGTH, PLACE_REF_MAX_LENGTH } from '../../../../shared'
import { nodeEnv } from '../../../core/index'
import { navigationLink } from './navigation-link'

/** Places API (New) autocomplete. No Place Details call (ADR-0031). */
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'

/** A few seconds. A hang becomes "unavailable" and the form stays plain text. */
const SUGGEST_TIMEOUT_MS = 4000

/** Named on the suggestion list whenever Google supplied the rows. */
export const GOOGLE_ATTRIBUTION = 'Google'

export interface PlacesHttpResponse {
  readonly status: number
  readonly body: string
}

export type PlacesHttp = (
  url: string,
  init: {
    readonly body: string
    readonly headers: Record<string, string>
    readonly signal: AbortSignal
  },
) => Promise<PlacesHttpResponse>

const unavailable: SuggestAddressesResult = { available: false }

const autocompleteSchema = z.object({
  suggestions: z.array(z.object({
    placePrediction: z.object({
      placeId: z.string(),
      text: z.object({
        text: z.string(),
      }),
    }).optional(),
  })).optional(),
})

/**
 * Google Places autocomplete. The key stays in the header. The body has
 * the typed text, the session token, and the language, and nothing that
 * would restrict a country or bias a region.
 */
export function createGoogleMaps(apiKey: string, http: PlacesHttp = fetchPlaces): MapsPort {
  return {
    async suggestAddresses(query) {
      try {
        const response = await http(AUTOCOMPLETE_URL, {
          body: JSON.stringify({
            input: query.text,
            sessionToken: query.sessionToken,
            languageCode: query.language,
          }),
          headers: {
            'content-type': 'application/json',
            'X-Goog-Api-Key': apiKey,
          },
          signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
        })
        if (response.status !== 200)
          return unavailable
        return mapSuggestions(response.body)
      }
      catch {
        return unavailable
      }
    },
    navigationLink,
  }
}

function mapSuggestions(body: string): SuggestAddressesResult {
  let json: unknown
  try {
    json = JSON.parse(body)
  }
  catch {
    return unavailable
  }
  const parsed = autocompleteSchema.safeParse(json)
  if (!parsed.success)
    return unavailable
  const suggestions = []
  for (const row of parsed.data.suggestions ?? []) {
    const prediction = row.placePrediction
    if (!prediction)
      continue
    const text = prediction.text.text.trim()
    const placeRef = prediction.placeId.trim()
    if (text.length === 0 || text.length > LOCATION_ADDRESS_MAX_LENGTH)
      continue
    if (placeRef.length === 0 || placeRef.length > PLACE_REF_MAX_LENGTH)
      continue
    suggestions.push({ text, provider: 'google' as const, placeRef })
  }
  return {
    available: true,
    suggestions,
    attribution: GOOGLE_ATTRIBUTION,
  }
}

async function fetchPlaces(url: string, init: {
  readonly body: string
  readonly headers: Record<string, string>
  readonly signal: AbortSignal
}): Promise<PlacesHttpResponse> {
  // Tests use the fake adapter. A stubbed client is passed in unit tests.
  if (nodeEnv() === 'test')
    throw new Error('Maps tests must not call Google.')
  const response = await fetch(url, {
    method: 'POST',
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  })
  return { status: response.status, body: await response.text() }
}
