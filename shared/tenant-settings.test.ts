import { expect, it } from 'vitest'
import {
  AIRPORT_WAIT_DEFAULT_MINUTES,
  ELSEWHERE_WAIT_DEFAULT_MINUTES,
  ianaTimeZoneSchema,
  parseTenantSettingsPatch,
  TENANT_TIME_ZONE_DEFAULT,
  TenantSettingsError,
  tenantSettingsPatchSchema,
  tenantSettingsSchema,
  TIME_ZONE_MAX_LENGTH,
} from './tenant-settings'

it('a Tenant starts at a 90-minute airport wait, 25 minutes elsewhere, and Europe/Zagreb', () => {
  expect(AIRPORT_WAIT_DEFAULT_MINUTES).toBe(90)
  expect(ELSEWHERE_WAIT_DEFAULT_MINUTES).toBe(25)
  expect(TENANT_TIME_ZONE_DEFAULT).toBe('Europe/Zagreb')
  expect(tenantSettingsSchema.parse({
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
    timeZone: 'Europe/Zagreb',
  })).toEqual({
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
    timeZone: 'Europe/Zagreb',
  })
})

it('accepts a wait of 1 or 1440 minutes and refuses what is outside that, a fraction, or a string', () => {
  expect(tenantSettingsPatchSchema.safeParse({ airportWaitMinutes: 1 }).success).toBe(true)
  expect(tenantSettingsPatchSchema.safeParse({ elsewhereWaitMinutes: 1440 }).success).toBe(true)
  expect(tenantSettingsPatchSchema.safeParse({ airportWaitMinutes: 0 }).success).toBe(false)
  expect(tenantSettingsPatchSchema.safeParse({ airportWaitMinutes: 1441 }).success).toBe(false)
  expect(tenantSettingsPatchSchema.safeParse({ elsewhereWaitMinutes: 25.5 }).success).toBe(false)
  expect(tenantSettingsPatchSchema.safeParse({ airportWaitMinutes: -5 }).success).toBe(false)
  expect(tenantSettingsPatchSchema.safeParse({ airportWaitMinutes: '90' }).success).toBe(false)
})

it('accepts every IANA zone Intl knows and refuses a name that is not one', () => {
  const zones = Intl.supportedValuesOf('timeZone')
  const longest = zones.reduce((best, zone) => zone.length > best.length ? zone : best)
  expect(longest.length).toBeLessThanOrEqual(TIME_ZONE_MAX_LENGTH)
  expect(ianaTimeZoneSchema.safeParse(longest).success).toBe(true)
  expect(ianaTimeZoneSchema.safeParse('Europe/Zagreb').success).toBe(true)
  expect(ianaTimeZoneSchema.safeParse('Europe/Berlin').success).toBe(true)
  expect(ianaTimeZoneSchema.safeParse('UTC').success).toBe(true)
  expect(ianaTimeZoneSchema.safeParse('Etc/UTC').success).toBe(true)
  expect(ianaTimeZoneSchema.safeParse('Not/AZone').success).toBe(false)
  expect(ianaTimeZoneSchema.safeParse('europe/zagreb').success).toBe(false)
  expect(ianaTimeZoneSchema.safeParse('').success).toBe(false)
})

it('refuses an unknown key, so a name or an email cannot ride along in the body', () => {
  expect(tenantSettingsPatchSchema.safeParse({}).success).toBe(true)
  expect(tenantSettingsPatchSchema.safeParse({
    airportWaitMinutes: 90,
    email: 'ana@example.com',
  }).success).toBe(false)
  expect(() => parseTenantSettingsPatch({ timeZone: 'Not/AZone' })).toThrow(TenantSettingsError)
  expect(() => parseTenantSettingsPatch(null)).toThrow(TenantSettingsError)
})
