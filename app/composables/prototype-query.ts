import type { LocationQuery } from 'vue-router'
import { parsePrototypeVariant } from '../prototype/tokens'

/** `?variant=` is the only switch the ADRs left open. Other query keys stay. */
export function usePrototypeQuery() {
  const route = useRoute()
  const variant = computed(() => parsePrototypeVariant(route.query.variant))

  function query(extra: Record<string, string | undefined> = {}): Record<string, string> {
    const next: Record<string, string> = { variant: variant.value }
    for (const [key, value] of Object.entries(route.query as LocationQuery)) {
      if (typeof value === 'string' && key !== 'variant')
        next[key] = value
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined)
        delete next[key]
      else
        next[key] = value
    }
    return next
  }

  function to(path: string, extra: Record<string, string | undefined> = {}) {
    return { path, query: query(extra) }
  }

  return { route, variant, query, to }
}
