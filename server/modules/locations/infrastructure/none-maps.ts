import type { MapsPort } from '../maps-port'
import { navigationLink } from './navigation-link'

/**
 * Suggestions are off. The navigation link still opens directions.
 * There is no Embed URL in this mode, even when a key is present (ADR-0052).
 */
export function createNoneMaps(): MapsPort {
  return {
    async suggestAddresses() {
      return { available: false }
    },
    navigationLink,
    embedUrl() {
      return null
    },
    // No Place Details call in this mode. Unavailable leaves a stored
    // reference alone if something asks anyway (ADR-0052).
    async checkPlaceRef() {
      return { outcome: 'unavailable' }
    },
  }
}
