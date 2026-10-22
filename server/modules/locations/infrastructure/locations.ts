import type { SQL } from 'drizzle-orm'
import type { CreateLocation, Location, LocationField, LocationPatch } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { LOCATION_FIELDS, LocationInputError, locationKindSchema, locationPlaceSchema, locationSchema } from '../../../../shared'
import { appendAuditEntry } from '../../audit'

const locationRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: locationKindSchema,
  address: z.string().nullable(),
  iata: z.string().nullable(),
  placeProvider: z.string().nullable(),
  placeRef: z.string().nullable(),
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

/**
 * Another active Location in this Tenant already holds this airport code.
 * The message is a fixed phrase and does not include the code.
 */
export class LocationIataTakenError extends Error {
  readonly statusCode = 409
  readonly code = 'location_iata_taken'

  constructor() {
    super('Conflict')
    this.name = 'LocationIataTakenError'
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
  id, name, kind, address, iata,
  place_provider as "placeProvider",
  place_ref as "placeRef",
  archived_at as "archivedAt"
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
 * the kind, the address, the code, or the place reference.
 * A pick stamps `place_ref_checked_at` in this same insert. A typed
 * address leaves that column null (ADR-0052).
 * The caller has already required a dispatcher or an admin.
 */
export async function addLocation(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreateLocation,
): Promise<Location> {
  const selected = locationRows.parse(await writeLocation(transaction, sql`
    insert into app.locations (
      name, kind, address, iata, place_provider, place_ref, place_ref_checked_at
    )
    values (
      ${input.name},
      ${input.kind},
      ${input.address},
      ${input.iata},
      ${input.place?.provider ?? null},
      ${input.place?.placeRef ?? null},
      -- A null parameter has no type. The cast lets Postgres see text.
      case when cast(${input.place?.placeRef ?? null} as text) is null then null else now() end
    )
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
 * A pick stamps `place_ref_checked_at`. A hand edit or a clear empties it
 * with the reference. A save that leaves the reference alone keeps the time
 * (ADR-0052). The column is not part of the Location the office reads.
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
        address = ${next.address},
        iata = ${next.iata},
        place_provider = ${next.place?.provider ?? null},
        place_ref = ${next.place?.placeRef ?? null},
        place_ref_checked_at = case
          when place_ref is not distinct from cast(${next.place?.placeRef ?? null} as text) then place_ref_checked_at
          when cast(${next.place?.placeRef ?? null} as text) is null then null
          else now()
        end
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
  if (input.iata !== null)
    set.add('iata')
  if (input.place !== null)
    set.add('placeRef')
  return LOCATION_FIELDS.filter(field => set.has(field))
}

/**
 * A change of provider or of reference is one `placeRef` entry.
 * The entry stores the field name only.
 */
function changedFields(current: Location, next: Location): LocationField[] {
  return LOCATION_FIELDS.filter((field) => {
    if (field === 'placeRef')
      return placeChanged(current.place, next.place)
    return next[field] !== current[field]
  })
}

function placeChanged(current: Location['place'], next: Location['place']): boolean {
  if (current === null || next === null)
    return current !== next
  return current.provider !== next.provider || current.placeRef !== next.placeRef
}

function applyPatch(current: Location, patch: LocationPatch): Location {
  const kind = patch.kind === undefined ? current.kind : patch.kind
  const iata = nextIata(current, patch, kind)
  const address = patch.address === undefined ? current.address : patch.address
  return locationSchema.parse({
    id: current.id,
    name: patch.name === undefined ? current.name : patch.name,
    kind,
    address,
    iata,
    place: nextPlace(current, patch, address),
    archivedAt: current.archivedAt,
  })
}

/**
 * A new place replaces the stored one. A hand edit of the address, or
 * clearing it, drops the place in the same write. Sending a place when the
 * address ends up empty is refused, and the caller writes nothing.
 */
function nextPlace(current: Location, patch: LocationPatch, address: string | null): Location['place'] {
  if (patch.place != null && address === null)
    throw new LocationInputError()
  if (address === null)
    return null
  if (patch.place !== undefined)
    return patch.place
  if (patch.address !== undefined && patch.address !== current.address)
    return null
  return current.place
}

/**
 * Only an airport keeps a code. Leaving that kind clears it in this same
 * change. Sending a code onto a hotel, an address, or any other kind is
 * refused, and the caller writes nothing.
 */
function nextIata(current: Location, patch: LocationPatch, kind: Location['kind']): string | null {
  if (kind !== 'airport') {
    if (patch.iata)
      throw new LocationInputError()
    return null
  }
  return patch.iata === undefined ? current.iata : patch.iata
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
    id: row.id,
    name: row.name,
    kind: row.kind,
    address: row.address,
    iata: row.iata,
    place: placeFromRow(row),
    archivedAt: toArchivedAt(row.archivedAt),
  })
}

/**
 * Both columns are set or both are empty. A broken pair is a fixed error.
 * The reference is not copied into the message, because that text is logged.
 */
function placeFromRow(row: z.infer<typeof locationRowSchema>): Location['place'] {
  if (row.placeProvider === null && row.placeRef === null)
    return null
  const parsed = locationPlaceSchema.safeParse({
    provider: row.placeProvider,
    placeRef: row.placeRef,
  })
  if (!parsed.success)
    throw new Error('Location read failed')
  return parsed.data
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
 * Run one insert or update. A duplicate live airport code is a conflict.
 * Every other failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown. An address or
 * a code in that text would otherwise land in the log.
 */
async function writeLocation(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  try {
    return await transaction.execute(query)
  }
  catch (error) {
    // A duplicate live code is a conflict. The Postgres message can contain
    // the code, so it is never rethrown.
    if (isIataUniqueViolation(error))
      throw new LocationIataTakenError()
    throw new Error('Location write failed')
  }
}

/**
 * Drizzle wraps the Postgres error. The outer message includes the bound
 * parameters, so it is never rethrown: a code in that text would be logged.
 * Only the live-code unique index is a conflict. Any other unique failure
 * is a write failure, not a 409.
 */
function isIataUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = 'code' in current ? current.code : undefined
    const constraint = 'constraint' in current && typeof current.constraint === 'string' ? current.constraint : ''
    const message = 'message' in current && typeof current.message === 'string' ? current.message : ''
    if (code === '23505' && (constraint === 'locations_iata_active' || message.includes('locations_iata_active')))
      return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
