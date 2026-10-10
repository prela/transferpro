import type { SQL } from 'drizzle-orm'
import type { CreateVehicle, Vehicle, VehicleField, VehiclePatch } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { VEHICLE_FIELDS, vehicleDateSchema, vehicleKindSchema, vehicleSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'

const vehicleRowSchema = z.object({
  id: z.uuid(),
  registrationPlate: z.string(),
  kind: vehicleKindSchema,
  registrationExpiresOn: vehicleDateSchema,
  technicalInspectionExpiresOn: vehicleDateSchema,
  insuranceExpiresOn: vehicleDateSchema,
  description: z.string().nullable(),
  archivedAt: z.unknown().nullable(),
})

const vehicleRows = z.object({
  rows: z.array(vehicleRowSchema),
})

const vehicleIdRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/** The Vehicle is not in this Tenant. Another Tenant's row looks the same. */
export class VehicleNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'VehicleNotFoundError'
  }
}

/** A live plate is already on the list. The message is a fixed phrase. The plate is not in it. */
export class VehiclePlateTakenError extends Error {
  readonly statusCode = 409
  readonly code = 'vehicle_plate_taken'

  constructor() {
    super('Conflict')
    this.name = 'VehiclePlateTakenError'
  }
}

/** The Vehicle is archived and cannot be corrected. The message is a fixed phrase. */
export class VehicleArchivedError extends Error {
  readonly statusCode = 409
  readonly code = 'vehicle_archived'

  constructor() {
    super('Conflict')
    this.name = 'VehicleArchivedError'
  }
}

/** The plate is on an archived Vehicle. The message is a fixed phrase. The plate is not in it. */
export class VehicleArchivedPlateError extends Error {
  readonly statusCode = 409
  readonly code = 'vehicle_archived_plate'

  constructor() {
    super('Conflict')
    this.name = 'VehicleArchivedPlateError'
  }
}

const vehicleColumns = sql`
  id, registration_plate as "registrationPlate", kind,
  registration_expires_on::text as "registrationExpiresOn",
  technical_inspection_expires_on::text as "technicalInspectionExpiresOn",
  insurance_expires_on::text as "insuranceExpiresOn",
  description,
  archived_at as "archivedAt"
`

/**
 * Whether this Tenant's Vehicle can be given for a day.
 * `archived` stays readable on a roster row already stored; a new assignment
 * still refuses it. A missing id and another Tenant's id are the same result.
 * The roster module calls this through the Vehicles index, by id.
 * This read does not lock. Assignment uses `vehiclePresenceForAssign`.
 */
export type VehiclePresence = 'active' | 'archived' | 'missing'

const vehiclePresenceRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    archivedAt: z.unknown().nullable(),
  })),
})

export async function vehiclePresence(transaction: TenantTransaction, vehicleId: string): Promise<VehiclePresence> {
  return presenceOf(await transaction.execute(sql`
    select id, archived_at as "archivedAt"
    from app.vehicles
    where id = ${vehicleId}
  `))
}

/**
 * The same answer as `vehiclePresence`, and a `for share` lock on the row.
 * Archive takes `for update`, so it cannot commit between this read and the
 * Ride update on the caller's transaction. The roster pre-fill does not use
 * this read: a suggestion does not write a Ride.
 */
export async function vehiclePresenceForAssign(transaction: TenantTransaction, vehicleId: string): Promise<VehiclePresence> {
  return presenceOf(await readVehicleForAssign(transaction, sql`
    select id, archived_at as "archivedAt"
    from app.vehicles
    where id = ${vehicleId}
    for share
  `))
}

function presenceOf(selected: unknown): VehiclePresence {
  const row = vehiclePresenceRows.parse(selected).rows[0]
  if (!row)
    return 'missing'
  return row.archivedAt === null ? 'active' : 'archived'
}

/**
 * Run the assign read. Every failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown. A vehicle id
 * in that text would otherwise land in the log.
 */
function readVehicleForAssign(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Vehicle read failed')
}

/** This Tenant's Vehicles, by plate, so the office can find one. */
export async function loadVehicles(
  transaction: TenantTransaction,
  includeArchived: boolean,
): Promise<Vehicle[]> {
  const selected = vehicleRows.parse(await transaction.execute(sql`
    select ${vehicleColumns}
    from app.vehicles
    where ${includeArchived ? sql`true` : sql`archived_at is null`}
    order by registration_plate, id
  `))
  return selected.rows.map(toVehicle)
}

/**
 * One Vehicle in this Tenant, archived or not.
 * A missing id and another Tenant's id are the same result.
 * The Driver upcoming read calls this through the Vehicles index so a Ride
 * still shows the plate after the Vehicle is archived. This read does not
 * apply the office role check: the caller already required a Driver.
 */
export async function loadVehicle(transaction: TenantTransaction, vehicleId: string): Promise<Vehicle> {
  const selected = vehicleRows.parse(await transaction.execute(sql`
    select ${vehicleColumns}
    from app.vehicles
    where id = ${vehicleId}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new VehicleNotFoundError()
  return toVehicle(row)
}

/**
 * Insert one Vehicle and append `vehicle.created` on this transaction.
 * The entry names the fields that were set. It does not store the plate,
 * the expiry dates, or the kind.
 * The caller has already required a dispatcher or an admin.
 */
export async function addVehicle(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreateVehicle,
): Promise<Vehicle> {
  const selected = vehicleRows.parse(await writeVehicle(transaction, sql`
    insert into app.vehicles (
      registration_plate, kind,
      registration_expires_on, technical_inspection_expires_on, insurance_expires_on,
      description
    )
    values (
      ${input.registrationPlate}, ${input.kind},
      ${input.registrationExpiresOn}, ${input.technicalInspectionExpiresOn},
      ${input.insuranceExpiresOn}, ${input.description}
    )
    returning ${vehicleColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Vehicle insert returned no row.')
  const vehicle = toVehicle(row)
  await appendAuditEntry(transaction, {
    action: 'vehicle.created',
    actorUserId,
    subjectUserId: null,
    data: { vehicleId: vehicle.id, fields: createdFields(input) },
  })
  return vehicle
}

/**
 * Correct the fields the patch names. One entry per field that changed,
 * and the entry stores the field name only.
 * A patch that matches the locked row does not update and does not append.
 * A missing row is not found, including a row that belongs to another Tenant.
 */
export async function correctVehicle(
  transaction: TenantTransaction,
  actorUserId: string,
  vehicleId: string,
  patch: VehiclePatch,
): Promise<Vehicle> {
  const current = await lockVehicle(transaction, vehicleId)
  if (current.archivedAt !== null)
    throw new VehicleArchivedError()
  const next = applyPatch(current, patch)
  if (patch.registrationPlate !== undefined && patch.registrationPlate !== current.registrationPlate)
    await assertArchivedPlateBlocks(transaction, next.registrationPlate, current.id)
  const fields = changedFields(current, next)
  if (fields.length === 0)
    return current

  await writeVehicle(transaction, sql`
    update app.vehicles
    set registration_plate = ${next.registrationPlate},
        kind = ${next.kind},
        registration_expires_on = ${next.registrationExpiresOn},
        technical_inspection_expires_on = ${next.technicalInspectionExpiresOn},
        insurance_expires_on = ${next.insuranceExpiresOn},
        description = ${next.description}
    where id = ${next.id}
  `)

  for (const field of fields) {
    await appendAuditEntry(transaction, {
      action: 'vehicle.field_changed',
      actorUserId,
      subjectUserId: null,
      data: { vehicleId: current.id, field },
    })
  }
  return next
}

/**
 * Set archived_at. The Vehicle stays on the row so a later Ride can still
 * show it. A second archive writes nothing.
 */
export async function archiveStoredVehicle(
  transaction: TenantTransaction,
  actorUserId: string,
  vehicleId: string,
): Promise<Vehicle> {
  const current = await lockVehicle(transaction, vehicleId)
  if (current.archivedAt !== null)
    return current

  const selected = vehicleRows.parse(await writeVehicle(transaction, sql`
    update app.vehicles
    set archived_at = now()
    where id = ${current.id}
    returning ${vehicleColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Vehicle archive returned no row.')
  const vehicle = toVehicle(row)
  await appendAuditEntry(transaction, {
    action: 'vehicle.archived',
    actorUserId,
    subjectUserId: null,
    data: { vehicleId: current.id },
  })
  return vehicle
}

function createdFields(input: CreateVehicle): VehicleField[] {
  const fields: VehicleField[] = [
    'registrationPlate',
    'kind',
    'registrationExpiresOn',
    'technicalInspectionExpiresOn',
    'insuranceExpiresOn',
  ]
  if (input.description !== null)
    fields.push('description')
  return fields
}

function changedFields(current: Vehicle, next: Vehicle): VehicleField[] {
  return VEHICLE_FIELDS.filter(field => next[field] !== current[field])
}

function applyPatch(current: Vehicle, patch: VehiclePatch): Vehicle {
  return vehicleSchema.parse({
    id: current.id,
    registrationPlate: patch.registrationPlate === undefined ? current.registrationPlate : patch.registrationPlate,
    kind: patch.kind === undefined ? current.kind : patch.kind,
    registrationExpiresOn: patch.registrationExpiresOn === undefined
      ? current.registrationExpiresOn
      : patch.registrationExpiresOn,
    technicalInspectionExpiresOn: patch.technicalInspectionExpiresOn === undefined
      ? current.technicalInspectionExpiresOn
      : patch.technicalInspectionExpiresOn,
    insuranceExpiresOn: patch.insuranceExpiresOn === undefined
      ? current.insuranceExpiresOn
      : patch.insuranceExpiresOn,
    description: patch.description === undefined ? current.description : patch.description,
    archivedAt: current.archivedAt,
  })
}

async function lockVehicle(transaction: TenantTransaction, vehicleId: string): Promise<Vehicle> {
  const selected = vehicleRows.parse(await transaction.execute(sql`
    select ${vehicleColumns}
    from app.vehicles
    where id = ${vehicleId}
    for update
  `))
  const row = selected.rows[0]
  if (!row)
    throw new VehicleNotFoundError()
  return toVehicle(row)
}

function toVehicle(row: z.infer<typeof vehicleRowSchema>): Vehicle {
  return vehicleSchema.parse({
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
      throw new Error('Vehicle archived_at is not a timestamp.')
    return parsed.toISOString()
  }
  throw new Error('Vehicle archived_at is not a timestamp.')
}

/**
 * Run one insert or update. A duplicate live plate is a bad request.
 * Every other failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown.
 */
async function writeVehicle(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  try {
    return await transaction.execute(query)
  }
  catch (error) {
    if (isPlateUniqueViolation(error))
      throw new VehiclePlateTakenError()
    throw new Error('Vehicle write failed')
  }
}

/**
 * A correction to a plate that only an archived Vehicle holds is refused so
 * the office can show archived rows or restore the archived Vehicle first.
 * Reusing a plate after archive is still allowed on create.
 */
async function assertArchivedPlateBlocks(
  transaction: TenantTransaction,
  plate: string,
  excludeId: string,
): Promise<void> {
  const archived = vehicleIdRows.parse(await transaction.execute(sql`
    select id
    from app.vehicles
    where registration_plate = ${plate}
      and archived_at is not null
      and id <> ${excludeId}
    limit 1
  `))
  if (archived.rows.length === 0)
    return
  const live = vehicleIdRows.parse(await transaction.execute(sql`
    select id
    from app.vehicles
    where registration_plate = ${plate}
      and archived_at is null
      and id <> ${excludeId}
    limit 1
  `))
  if (live.rows.length > 0)
    return
  throw new VehicleArchivedPlateError()
}

/**
 * Drizzle wraps the Postgres error. The outer message includes the bound
 * parameters, so it is never rethrown: a plate in that text would be logged.
 * Only the live-plate unique index is a conflict. Any other unique failure
 * is a write failure, not a 409.
 */
function isPlateUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = 'code' in current ? current.code : undefined
    const constraint = 'constraint' in current && typeof current.constraint === 'string' ? current.constraint : ''
    const message = 'message' in current && typeof current.message === 'string' ? current.message : ''
    if (code === '23505' && (constraint === 'vehicles_plate_active' || message.includes('vehicles_plate_active')))
      return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
