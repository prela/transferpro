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
  }
}
