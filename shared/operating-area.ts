import { z } from 'zod'

/**
 * Field names an operating-area audit row may store.
 * The name, the centre, and the radius stay off the row (ADR-0063).
 */
export const OPERATING_AREA_FIELDS = ['name', 'center', 'radiusM'] as const

export type OperatingAreaField = (typeof OPERATING_AREA_FIELDS)[number]

/** Google's circle is at most 50 km. One kilometre is the smallest the command accepts. */
export const OPERATING_AREA_RADIUS_MIN_M = 1000
export const OPERATING_AREA_RADIUS_MAX_M = 50000
export const OPERATING_AREA_RADIUS_MIN_KM = 1
export const OPERATING_AREA_RADIUS_MAX_KM = 50

export const OPERATING_AREA_LATITUDE_MIN = -90
export const OPERATING_AREA_LATITUDE_MAX = 90
export const OPERATING_AREA_LONGITUDE_MIN = -180
export const OPERATING_AREA_LONGITUDE_MAX = 180

/**
 * Centre and radius in metres on WGS84.
 * The suggestion port and the Tenant read share this shape, and neither imports the other (ADR-0018).
 */
export interface OperatingAreaCircle {
  readonly latitude: number
  readonly longitude: number
  readonly radiusM: number
}

/**
 * A set and an archive both record these three names, in this order, and nothing else.
 * The command writes the whole area, so a subset would look like a partial edit (ADR-0063).
 */
export const operatingAreaFieldsSchema = z.tuple([
  z.literal('name'),
  z.literal('center'),
  z.literal('radiusM'),
])

/** Archive records the same three names. One field would look like a partial edit. */
export const operatingAreaArchivedFieldsSchema = operatingAreaFieldsSchema
