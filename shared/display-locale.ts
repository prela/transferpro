import { z } from 'zod'

export const displayLocaleSchema = z.enum(['hr', 'en'])

export type DisplayLocale = z.infer<typeof displayLocaleSchema>

/**
 * ADR-0011: a null user locale means the Tenant's default_locale.
 * An unknown user value falls back the same way. A bad tenant default is a broken row.
 */
export function resolveDisplayLocale(
  userLocale: string | null | undefined,
  tenantDefault: string,
): DisplayLocale {
  const chosen = displayLocaleSchema.safeParse(userLocale)
  if (chosen.success)
    return chosen.data
  return displayLocaleSchema.parse(tenantDefault)
}
