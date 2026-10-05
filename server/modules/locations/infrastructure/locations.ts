import type { SQL } from 'drizzle-orm'
import type { CreateLocation, Location, LocationField, LocationPatch } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { LOCATION_FIELDS, locationKindSchema, locationSchema } from '../../../../shared'
import { appendAuditEntry } from '../../audit'

const locationRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: locationKindSchema,
  address: z.string().nullable(),
  archivedAt: z.unknown().nullable(),
})

const locationRows = z.object({
  rows: z.array(locationRowSchema),
})

/** The Location is not in this Tenant. Another Tenant's row looks the same. */
export class LocationNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'LocationNotFoundError'
  }
}

/** The Location is archived and cannot be corrected. The message is a fixed phrase. */
export class LocationArchivedError extends Error {
  readonly statusCode = 409
  readonly code = 'location_archived'

  constructor() {
    super('Conflict')
    this.name = 'LocationArchivedError'
  }
}

const locationColumns = sql`
  id, name, kind, address, archived_at as "archivedAt"
`

/**
 * This Tenant's Locations, by name, so the office can find one.
 * Archived rows stay out unless the caller asks for them. A later Transfer
 * still loads an archived row by id.
 */
export async function loadLocations(
  transaction: TenantTransaction,
  includeArchived: boolean,
): Promise<Location[]> {
  const selected = locationRows.parse(await transaction.execute(sql`
    select ${locationColumns}
    from app.locations
    where ${includeArchived ? sql`true` : sql`archived_at is null`}
    order by name, id
  `))
  return selected.rows.map(toLocation)
}

/**
 * One Location in this Tenant, archived or not.
 * A missing id and another Tenant's id are the same result.
 * Transfers will call this through the Locations index, by id.
 */
export async function loadLocation(
  transaction: TenantTransaction,
  locationId: string,
): Promise<Location> {
  const selected = locationRows.parse(await transaction.execute(sql`
    select ${locationColumns}
    from app.locations
    where id = ${locationId}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new LocationNotFoundError()
  return toLocation(row)
}

/**
 * Insert one Location and append `location.created` on this transaction.
 * The entry names the fields that were set. It does not store the name,
 * the kind, or the address.
 * The caller has already required a dispatcher or an admin.
 */
export async function addLocation(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreateLocation,
): Promise<Location> {
  const selected = locationRows.parse(await writeLocation(transaction, sql`
    insert into app.locations (name, kind, address)
    values (${input.name}, ${input.kind}, ${input.address})
    returning ${locationColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Location insert returned no row.')
  const location = toLocation(row)
  await appendAuditEntry(transaction, {
    action: 'location.created',
    actorUserId,
    subjectUserId: null,
    data: { locationId: location.id, fields: createdFields(input) },
  })
  return location
}

/**
 * Correct the fields the patch names. One entry per field that changed,
 * and the entry stores the field name only.
 * A patch that matches the locked row does not update and does not append.
 * A missing row is not found, including a row that belongs to another Tenant.
 * An archived Location is refused: the picker hides it, and a Transfer that
 * already points at it still loads it by id.
 */
export async function correctLocation(
  transaction: TenantTransaction,
  actorUserId: string,
  locationId: string,
  patch: LocationPatch,
): Promise<Location> {
  const current = await lockLocation(transaction, locationId)
  if (current.archivedAt !== null)
    throw new LocationArchivedError()
  const next = applyPatch(current, patch)
  const fields = changedFields(current, next)
  if (fields.length === 0)
    return current

  await writeLocation(transaction, sql`
    update app.locations
    set name = ${next.name},
        kind = ${next.kind},
        address = ${next.address}
    where id = ${next.id}
  `)

  for (const field of fields) {
    await appendAuditEntry(transaction, {
      action: 'location.field_changed',
      actorUserId,
      subjectUserId: null,
      data: { locationId: current.id, field },
    })
  }
  return next
}

/**
 * Set archived_at. The Location stays on the row so a later Transfer can
 * still show it. A second archive writes nothing.
 */
export async function archiveStoredLocation(
  transaction: TenantTransaction,
  actorUserId: string,
  locationId: string,
): Promise<Location> {
  const current = await lockLocation(transaction, locationId)
  if (current.archivedAt !== null)
    return current

  const selected = locationRows.parse(await writeLocation(transaction, sql`
    update app.locations
    set archived_at = now()
    where id = ${current.id}
    returning ${locationColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Location archive returned no row.')
  const location = toLocation(row)
  await appendAuditEntry(transaction, {
    action: 'location.archived',
    actorUserId,
    subjectUserId: null,
    data: { locationId: current.id },
  })
  return location
}

function createdFields(input: CreateLocation): LocationField[] {
  const set = new Set<LocationField>(['name', 'kind'])
  if (input.address !== null)
    set.add('address')
  return LOCATION_FIELDS.filter(field => set.has(field))
}

function changedFields(current: Location, next: Location): LocationField[] {
  return LOCATION_FIELDS.filter(field => next[field] !== current[field])
}

function applyPatch(current: Location, patch: LocationPatch): Location {
  return locationSchema.parse({
    id: current.id,
    name: patch.name === undefined ? current.name : patch.name,
    kind: patch.kind === undefined ? current.kind : patch.kind,
    address: patch.address === undefined ? current.address : patch.address,
    archivedAt: current.archivedAt,
  })
}

async function lockLocation(transaction: TenantTransaction, locationId: string): Promise<Location> {
  const selected = locationRows.parse(await transaction.execute(sql`
    select ${locationColumns}
    from app.locations
    where id = ${locationId}
    for update
  `))
  const row = selected.rows[0]
  if (!row)
    throw new LocationNotFoundError()
  return toLocation(row)
}

function toLocation(row: z.infer<typeof locationRowSchema>): Location {
  return locationSchema.parse({
    ...row,
    archivedAt: toArchivedAt(row.archivedAt),
  })
}

/**
 * node-pg may return a Date or a timestamp string. The API always uses ISO-8601 UTC.
 */
function toArchivedAt(value: unknown): string | null {
  if (value === null || value === undefined)
    return null
  if (value instanceof Date)
    return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()))
      throw new Error('Location archived_at is not a timestamp.')
    return parsed.toISOString()
  }
  throw new Error('Location archived_at is not a timestamp.')
}

/**
 * Run one insert or update. Every failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown. An address in
 * that text would otherwise land in the log.
 */
async function writeLocation(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  try {
    return await transaction.execute(query)
  }
  catch {
    throw new Error('Location write failed')
  }
}
