import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { auditActions, CLIENT_KINDS, DRIVER_FIELDS, tenantRoleSchema, TIME_ZONE_MAX_LENGTH, VEHICLE_FIELDS, WAIT_MINUTES_MAX, WAIT_MINUTES_MIN } from '../shared'
import { appSchema, tenantTable } from './tenant-table'

export const auditAction = appSchema.enum('audit_action', auditActions)

// drizzle-kit writes a check's SQL into the migration as text, so literals are raw, never parameters.
const tenantRoles = sql.raw(tenantRoleSchema.options.map(role => `'${role}'`).join(', '))

/** `data` holds exactly `keys`, and each one is a Tenant role. */
function rolesOnly(data: AnyPgColumn, ...keys: string[]) {
  return sql.join([
    sql`${data} - ${sql.raw(`'{${keys.join(',')}}'::text[]`)} = '{}'::jsonb`,
    ...keys.map(key => sql`${data} ->> ${sql.raw(`'${key}'`)} in (${tenantRoles})`),
  ], sql` and `)
}

/** `data` holds exactly `from` and `to`. */
function fromToOnly(data: AnyPgColumn) {
  return sql`${data} - ${sql.raw(`'{from,to}'::text[]`)} = '{}'::jsonb`
}

/**
 * One side of a wait change: a JSON number whose text is an integer in range.
 * The CASE avoids casting a string, which would abort the check with a
 * different error than a shape violation.
 */
function minuteBound(data: AnyPgColumn, key: 'from' | 'to') {
  const name = sql.raw(`'${key}'`)
  const min = sql.raw(String(WAIT_MINUTES_MIN))
  const max = sql.raw(String(WAIT_MINUTES_MAX))
  return sql`(case when jsonb_typeof(${data} -> ${name}) = 'number' and (${data} ->> ${name}) ~ '^[0-9]+$' then (${data} ->> ${name})::integer between ${min} and ${max} else false end)`
}

function minutesFromTo(data: AnyPgColumn) {
  return sql.join([
    fromToOnly(data),
    minuteBound(data, 'from'),
    minuteBound(data, 'to'),
  ], sql` and `)
}

/** One side of a time-zone change: a string, length only. IANA is checked in Zod. */
function zoneBound(data: AnyPgColumn, key: 'from' | 'to') {
  const name = sql.raw(`'${key}'`)
  const max = sql.raw(String(TIME_ZONE_MAX_LENGTH))
  return sql`jsonb_typeof(${data} -> ${name}) = 'string' and length(${data} ->> ${name}) between 1 and ${max}`
}

function zonesFromTo(data: AnyPgColumn) {
  return sql.join([
    fromToOnly(data),
    zoneBound(data, 'from'),
    zoneBound(data, 'to'),
  ], sql` and `)
}

const clientKinds = sql.raw(CLIENT_KINDS.map(kind => `'${kind}'`).join(', '))

/** `data` holds exactly these keys, and nothing else. */
function keysOnly(data: AnyPgColumn, ...keys: string[]) {
  return sql`${data} - ${sql.raw(`'{${keys.join(',')}}'::text[]`)} = '{}'::jsonb`
}

/**
 * A Client id stored as text. Zod's uuid is the same RFC 4122 shape.
 * `~*` so a lowercase or uppercase hex id both pass.
 */
function clientIdText(data: AnyPgColumn) {
  return sql`jsonb_typeof(${data} -> ${sql.raw(`'clientId'`)}) = 'string' and ${data} ->> ${sql.raw(`'clientId'`)} ~* ${sql.raw(`'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`)}`
}

function kindText(data: AnyPgColumn, key: string) {
  const name = sql.raw(`'${key}'`)
  return sql`${data} ->> ${name} in (${clientKinds})`
}

const driverFields = sql.raw(DRIVER_FIELDS.map(field => `'${field}'`).join(', '))
const driverFieldsJson = sql.raw(`'${JSON.stringify([...DRIVER_FIELDS])}'::jsonb`)
const driverFieldCount = sql.raw(String(DRIVER_FIELDS.length))

/** A Driver id stored as text. Same RFC 4122 shape as a Client id. */
function driverIdText(data: AnyPgColumn) {
  return sql`jsonb_typeof(${data} -> ${sql.raw(`'driverId'`)}) = 'string' and ${data} ->> ${sql.raw(`'driverId'`)} ~* ${sql.raw(`'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`)}`
}

/** `field` is one name from the Driver list. A phone number cannot sit here. */
function driverFieldText(data: AnyPgColumn) {
  return sql`jsonb_typeof(${data} -> ${sql.raw(`'field'`)}) = 'string' and ${data} ->> ${sql.raw(`'field'`)} in (${driverFields})`
}

/**
 * `fields` is a non-empty array of those names. Containment refuses a
 * string that is not a field name, so a phone or a date cannot be an element.
 */
function driverFieldsArray(data: AnyPgColumn) {
  return sql`jsonb_typeof(${data} -> ${sql.raw(`'fields'`)}) = 'array' and jsonb_array_length(${data} -> ${sql.raw(`'fields'`)}) between 1 and ${driverFieldCount} and ${data} -> ${sql.raw(`'fields'`)} <@ ${driverFieldsJson}`
}

const vehicleFields = sql.raw(VEHICLE_FIELDS.map(field => `'${field}'`).join(', '))
const vehicleFieldsJson = sql.raw(`'${JSON.stringify([...VEHICLE_FIELDS])}'::jsonb`)
const vehicleFieldCount = sql.raw(String(VEHICLE_FIELDS.length))

/** A Vehicle id stored as text. Same RFC 4122 shape as a Driver id. */
function vehicleIdText(data: AnyPgColumn) {
  return sql`jsonb_typeof(${data} -> ${sql.raw(`'vehicleId'`)}) = 'string' and ${data} ->> ${sql.raw(`'vehicleId'`)} ~* ${sql.raw(`'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`)}`
}

/** `field` is one name from the Vehicle list. A plate cannot sit here. */
function vehicleFieldText(data: AnyPgColumn) {
  return sql`jsonb_typeof(${data} -> ${sql.raw(`'field'`)}) = 'string' and ${data} ->> ${sql.raw(`'field'`)} in (${vehicleFields})`
}

function vehicleFieldsArray(data: AnyPgColumn) {
  return sql`jsonb_typeof(${data} -> ${sql.raw(`'fields'`)}) = 'array' and jsonb_array_length(${data} -> ${sql.raw(`'fields'`)}) between 1 and ${vehicleFieldCount} and ${data} -> ${sql.raw(`'fields'`)} <@ ${vehicleFieldsJson}`
}

/**
 * Append-only (ADR-0014). The app role may only SELECT. Rows are written by
 * `audit.append_entry` and by the trigger on `auth.invitation`, and a trigger
 * refuses UPDATE, DELETE, and TRUNCATE for every role. drizzle-kit cannot
 * emit those grants, functions, or triggers; the migration SQL does.
 * User ids carry no foreign key, so an entry outlives the membership and the user.
 *
 * `audit_entry_shape` repeats `auditFactSchema` in the database, so no writer
 * can store a name or an email in a row that is never deleted. A new action
 * needs a branch here, or its rows are refused. Postgres checks constraints in
 * name order, so `audit_entry_data` refuses a non-object before the shape is read.
 */
export const auditEntry = tenantTable('audit_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  actorUserId: text('actor_user_id').notNull(),
  action: auditAction('action').notNull(),
  subjectUserId: text('subject_user_id'),
  data: jsonb('data').notNull(),
}, table => [
  index('audit_entry_tenant_occurred_at').on(table.tenantId, table.occurredAt.desc()),
  check('audit_entry_actor_user_id', sql`${table.actorUserId} <> ''`),
  check('audit_entry_data', sql`jsonb_typeof(${table.data}) = 'object'`),
  // `action::text` so this check does not cast the new labels to the enum.
  // drizzle applies every pending migration in one transaction, and Postgres
  // refuses to use an enum value added in that same transaction.
  check('audit_entry_shape', sql`(case ${table.action}::text
    when 'member.invited' then ${table.subjectUserId} is null and ${rolesOnly(table.data, 'role')}
    when 'member.role_changed' then ${table.subjectUserId} <> '' and ${rolesOnly(table.data, 'from', 'to')}
    when 'member.removed' then ${table.subjectUserId} <> '' and ${rolesOnly(table.data, 'role')}
    when 'settings.airport_wait_changed' then ${table.subjectUserId} is null and ${minutesFromTo(table.data)}
    when 'settings.elsewhere_wait_changed' then ${table.subjectUserId} is null and ${minutesFromTo(table.data)}
    when 'settings.time_zone_changed' then ${table.subjectUserId} is null and ${zonesFromTo(table.data)}
    when 'client.created' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'clientId', 'kind')} and ${clientIdText(table.data)} and ${kindText(table.data, 'kind')}
    when 'client.name_changed' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'clientId')} and ${clientIdText(table.data)}
    when 'client.kind_changed' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'clientId', 'from', 'to')} and ${clientIdText(table.data)} and ${kindText(table.data, 'from')} and ${kindText(table.data, 'to')}
    when 'driver.created' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'driverId', 'fields')} and ${driverIdText(table.data)} and ${driverFieldsArray(table.data)}
    when 'driver.field_changed' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'driverId', 'field')} and ${driverIdText(table.data)} and ${driverFieldText(table.data)}
    when 'vehicle.created' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'vehicleId', 'fields')} and ${vehicleIdText(table.data)} and ${vehicleFieldsArray(table.data)}
    when 'vehicle.field_changed' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'vehicleId', 'field')} and ${vehicleIdText(table.data)} and ${vehicleFieldText(table.data)}
    when 'vehicle.archived' then ${table.subjectUserId} is null and ${keysOnly(table.data, 'vehicleId')} and ${vehicleIdText(table.data)}
    else false end) is true`),
], { oneRowPerTenant: false })
