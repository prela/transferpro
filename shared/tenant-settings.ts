import { z } from 'zod'

/**
 * A No-show wait is at least one minute. Zero would let a Driver mark a
 * No-show at the instant the clock starts (ADR-0007). A day is the longest
 * a wait can be before the Ride is a forgotten one, not a late guest.
 * The pilot's 90 and 25 minutes sit inside this.
 */
export const WAIT_MINUTES_MIN = 1
export const WAIT_MINUTES_MAX = 24 * 60

export const AIRPORT_WAIT_DEFAULT_MINUTES = 90
export const ELSEWHERE_WAIT_DEFAULT_MINUTES = 25

/** Display zone for a new Tenant. Instants stay UTC. */
export const TENANT_TIME_ZONE_DEFAULT = 'Europe/Zagreb'

/**
 * The longest name `Intl.supportedValuesOf('timeZone')` returns today is 30
 * characters. 64 leaves room for a longer name in a later ICU without a
 * migration. Postgres checks the length. Whether Intl can format the name
 * is checked here, because Postgres has no time-zone catalog.
 */
export const TIME_ZONE_MAX_LENGTH = 64

const ianaTimeZones = new Set(Intl.supportedValuesOf('timeZone'))

/**
 * Canonical ids from `supportedValuesOf`, plus `UTC` and `Etc/UTC`, which
 * Intl can format and that list omits. `europe/zagreb` is not the id
 * `Europe/Zagreb`.
 */
function isIanaTimeZone(zone: string): boolean {
  if (!ianaTimeZones.has(zone) && zone !== 'UTC' && zone !== 'Etc/UTC')
    return false
  try {
    // format() is what the shell will do with the stored zone.
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(0).length > 0
  }
  catch {
    return false
  }
}

export const waitMinutesSchema = z.number().int().min(WAIT_MINUTES_MIN).max(WAIT_MINUTES_MAX)

export const ianaTimeZoneSchema = z.string().min(1).max(TIME_ZONE_MAX_LENGTH).refine(isIanaTimeZone)

export const tenantSettingsSchema = z.object({
  airportWaitMinutes: waitMinutesSchema,
  elsewhereWaitMinutes: waitMinutesSchema,
  timeZone: ianaTimeZoneSchema,
})

export type TenantSettings = z.infer<typeof tenantSettingsSchema>

/** A field that is absent stays as it is. An unknown key is refused. */
export const tenantSettingsPatchSchema = z.strictObject({
  airportWaitMinutes: waitMinutesSchema.optional(),
  elsewhereWaitMinutes: waitMinutesSchema.optional(),
  timeZone: ianaTimeZoneSchema.optional(),
})

export type TenantSettingsPatch = z.infer<typeof tenantSettingsPatchSchema>

/** The body was not a valid change. Nothing is written. */
export class TenantSettingsError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'TenantSettingsError'
  }
}

/**
 * Accepts a patch of the waits and the time zone. Any other body throws
 * first, so the caller does not open a session and does not write.
 */
export function parseTenantSettingsPatch(raw: unknown): TenantSettingsPatch {
  const parsed = tenantSettingsPatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new TenantSettingsError()
  return parsed.data
}
