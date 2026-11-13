import { sql } from 'drizzle-orm'
import { check, integer, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { LOCATION_NAME_MAX_LENGTH, OPERATING_AREA_LATITUDE_MAX, OPERATING_AREA_LATITUDE_MIN, OPERATING_AREA_LONGITUDE_MAX, OPERATING_AREA_LONGITUDE_MIN, OPERATING_AREA_RADIUS_MAX_M, OPERATING_AREA_RADIUS_MIN_M } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One operating area, many archived rows per Tenant, at most one active.
 * The centre is a point the platform owner typed from a public source.
 * It is not a Google coordinate (ADR-0063). Five decimals are about a metre.
 * Archive is `archived_at`. There is no delete.
 * FORCE RLS is in the migration; drizzle-kit cannot emit it.
 */

const nameMax = sql.raw(String(LOCATION_NAME_MAX_LENGTH))
const latMin = sql.raw(String(OPERATING_AREA_LATITUDE_MIN))
const latMax = sql.raw(String(OPERATING_AREA_LATITUDE_MAX))
const lngMin = sql.raw(String(OPERATING_AREA_LONGITUDE_MIN))
const lngMax = sql.raw(String(OPERATING_AREA_LONGITUDE_MAX))
const radiusMin = sql.raw(String(OPERATING_AREA_RADIUS_MIN_M))
const radiusMax = sql.raw(String(OPERATING_AREA_RADIUS_MAX_M))

export const operatingAreas = tenantTable('operating_area', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  centerLat: numeric('center_lat', { precision: 8, scale: 5 }).notNull(),
  centerLng: numeric('center_lng', { precision: 9, scale: 5 }).notNull(),
  radiusM: integer('radius_m').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => [
  check(
    'operating_area_name',
    sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${nameMax}`,
  ),
  check(
    'operating_area_center_lat',
    sql`${table.centerLat} between ${latMin} and ${latMax}`,
  ),
  check(
    'operating_area_center_lng',
    sql`${table.centerLng} between ${lngMin} and ${lngMax}`,
  ),
  check(
    'operating_area_radius_m',
    sql`${table.radiusM} between ${radiusMin} and ${radiusMax}`,
  ),
  // One active area per Tenant. A later decision on several areas drops this index.
  uniqueIndex('operating_area_one_active').on(table.tenantId).where(sql`${table.archivedAt} is null`),
], { oneRowPerTenant: false })
