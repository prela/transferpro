import type { MapsPort } from '../maps-port'
import { navigationLink } from './navigation-link'

/** Suggestions are off. The navigation link still opens directions. */
export function createNoneMaps(): MapsPort {
  return {
    async suggestAddresses() {
      return { available: false }
    },
    navigationLink,
  }
}
