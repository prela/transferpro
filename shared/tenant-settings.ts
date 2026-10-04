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
 * migration. Postgres checks the length. Membership of the IANA list is
 * checked here, because Postgres has no time-zone catalog.
 */
export const TIME_ZONE_MAX_LENGTH = 64

/**
 * Canonical ids from `supportedValuesOf` (the IANA zones this runtime
 * ships), plus `UTC` and `Etc/UTC`, which Intl can format and that list
 * omits. An alias such as `US/Eastern` or `GMT` is not in the list, and
 * neither is `europe/zagreb`. GET /api/tenant-settings sends this array.
 * The screen builds its dropdown from that reply, not from the browser.
 */
const supportedTimeZones = Intl.supportedValuesOf('timeZone')
const extraTimeZones = ['UTC', 'Etc/UTC'].filter(zone => !supportedTimeZones.includes(zone))

export const tenantTimeZoneIds: readonly string[] = [...supportedTimeZones, ...extraTimeZones]

const ianaTimeZones = new Set<string>(tenantTimeZoneIds)

/**
 * A zone already stored. A later runtime may drop a name from
 * `tenantTimeZoneIds`; reading the row, and recording it as `from`, still
 * has to succeed. A new zone goes through `isIanaTimeZone`.
 */
export const storedTimeZoneSchema = z.string().min(1).max(TIME_ZONE_MAX_LENGTH)

function isIanaTimeZone(zone: string): boolean {
  if (!ianaTimeZones.has(zone))
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

/**
 * A reply. The zone is whatever is stored, bounded like the column, and is
 * not checked against the current list. A write still uses `tenantSettingsSchema`.
 */
export const tenantSettingsResponseSchema = z.object({
  airportWaitMinutes: waitMinutesSchema,
  elsewhereWaitMinutes: waitMinutesSchema,
  timeZone: storedTimeZoneSchema,
})

export type TenantSettingsResponse = z.infer<typeof tenantSettingsResponseSchema>

/** GET adds the zones this server will accept on a write. */
export const tenantSettingsGetSchema = tenantSettingsResponseSchema.extend({
  timeZones: z.array(z.string().min(1).max(TIME_ZONE_MAX_LENGTH)),
})

export type TenantSettingsGet = z.infer<typeof tenantSettingsGetSchema>

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
