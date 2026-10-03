import type { DisplayLocale } from './display-locale'
import { z } from 'zod'
import { displayLocaleSchema } from './display-locale'

const bodySchema = z.object({
  locale: displayLocaleSchema,
})

/** The body was not hr or en. Nothing is written. */
export class LocaleChoiceError extends Error {
  constructor() {
    super('Locale must be hr or en.')
    this.name = 'LocaleChoiceError'
  }
}

/**
 * Accepts hr or en and then calls `write`. Any other body throws first,
 * so the caller does not touch the auth user.
 */
export async function saveDisplayLocale(
  body: unknown,
  write: (locale: DisplayLocale) => Promise<void>,
): Promise<DisplayLocale> {
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success)
    throw new LocaleChoiceError()
  await write(parsed.data.locale)
  return parsed.data.locale
}
