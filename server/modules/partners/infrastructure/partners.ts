import type { SQL } from 'drizzle-orm'
import type { CreatePartner, Partner, PartnerPatch } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { driverEmailSchema, driverPhoneSchema, partnerChangedFields, partnerCreatedFields, partnerNameSchema, partnerNoteSchema, partnerSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'

const partnerRowSchema = z.object({
  id: z.uuid(),
  name: partnerNameSchema,
  phone: driverPhoneSchema.nullable(),
  email: driverEmailSchema.nullable(),
  note: partnerNoteSchema.nullable(),
  archivedAt: z.unknown().nullable(),
})

const partnerRows = z.object({
  rows: z.array(partnerRowSchema),
})

const partnerIdRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/** The Partner is not in this Tenant. Another Tenant's row looks the same. */
export class PartnerNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'PartnerNotFoundError'
  }
}

/** The Partner is archived and cannot be corrected. The name is not in the message. */
export class PartnerArchivedError extends Error {
  readonly statusCode = 409
  readonly code = 'partner_archived'

  constructor() {
    super('Conflict')
    this.name = 'PartnerArchivedError'
  }
}

const partnerColumns = sql`
  id, name, phone, email, note,
  archived_at as "archivedAt"
`

/**
 * Ids of this Tenant's active Partners, by name.
 * An archived Partner is left out: capacity counts only a Partner that can
 * take a new Ride. Another Tenant's rows stay out under the session's row security.
 * This read does not lock and does not check a role. The caller already did.
 */
export async function loadActivePartnerIds(transaction: TenantTransaction): Promise<string[]> {
  const selected = partnerIdRows.parse(await readPartner(transaction, sql`
    select id
    from app.partners
    where archived_at is null
    order by name, id
  `))
  return selected.rows.map(row => row.id)
}

/**
 * Whether this id is an active Partner of the Tenant.
 * A missing id, an archived Partner, and another Tenant's id are false.
 * The select runs under the session's row security.
 */
export async function partnerIsActive(transaction: TenantTransaction, partnerId: string): Promise<boolean> {
  const selected = z.object({
    rows: z.array(z.object({ archivedAt: z.unknown().nullable() })),
  }).parse(await readPartner(transaction, sql`
    select archived_at as "archivedAt"
    from app.partners
    where id = ${partnerId}
  `))
  const row = selected.rows[0]
  if (!row)
    return false
  return toArchivedAt(row.archivedAt) === null
}

/**
 * This Tenant's Partners, by name, so the office can find one.
 * Archived rows stay out of the default list. A caller that still needs
 * the name passes true.
 */
export async function loadPartners(transaction: TenantTransaction, includeArchived: boolean): Promise<Partner[]> {
  const selected = partnerRows.parse(await readPartner(transaction, sql`
    select ${partnerColumns}
    from app.partners
    where ${includeArchived ? sql`true` : sql`archived_at is null`}
    order by name, id
  `))
  return selected.rows.map(toPartner)
}

/**
 * Insert one Partner and append `partner.created` on this transaction.
 * The entry names the fields that were set. It does not store the name,
 * the phone, the email, or the note.
 * The caller has already required a dispatcher or an admin.
 */
export async function addPartner(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreatePartner,
): Promise<Partner> {
  const selected = partnerRows.parse(await writePartner(transaction, sql`
    insert into app.partners (name, phone, email, note)
    values (${input.name}, ${input.phone}, ${input.email}, ${input.note})
    returning ${partnerColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Partner insert returned no row.')
  const partner = toPartner(row)
  await appendAuditEntry(transaction, {
    action: 'partner.created',
    actorUserId,
    subjectUserId: null,
    data: { partnerId: partner.id, fields: partnerCreatedFields(input) },
  })
  return partner
}

/**
 * Correct the fields the patch names. One entry lists every field that
 * changed, and the entry stores the field names only.
 * A patch that matches the locked row does not update and does not append.
 * An archived Partner is refused before any write.
 * A missing row is not found, including a row that belongs to another Tenant.
 */
export async function correctPartner(
  transaction: TenantTransaction,
  actorUserId: string,
  partnerId: string,
  patch: PartnerPatch,
): Promise<Partner> {
  const current = await lockPartner(transaction, partnerId)
  if (current.archivedAt !== null)
    throw new PartnerArchivedError()
  const next = applyPatch(current, patch)
  const fields = partnerChangedFields(current, next)
  if (fields.length === 0)
    return current

  await writePartner(transaction, sql`
    update app.partners
    set name = ${next.name},
        phone = ${next.phone},
        email = ${next.email},
        note = ${next.note}
    where id = ${next.id}
  `)
  await appendAuditEntry(transaction, {
    action: 'partner.changed',
    actorUserId,
    subjectUserId: null,
    data: { partnerId: current.id, fields },
  })
  return next
}

/**
 * Set archived_at. The Partner stays on the row so a Ride already handed
 * to it can still show the name. A second archive writes nothing.
 */
export async function archiveStoredPartner(
  transaction: TenantTransaction,
  actorUserId: string,
  partnerId: string,
): Promise<Partner> {
  const current = await lockPartner(transaction, partnerId)
  if (current.archivedAt !== null)
    return current

  const selected = partnerRows.parse(await writePartner(transaction, sql`
    update app.partners
    set archived_at = now()
    where id = ${current.id}
    returning ${partnerColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Partner archive returned no row.')
  const partner = toPartner(row)
  await appendAuditEntry(transaction, {
    action: 'partner.archived',
    actorUserId,
    subjectUserId: null,
    data: { partnerId: current.id },
  })
  return partner
}

/**
 * Clear archived_at. The Partner returns to the default list.
 * A Partner who is already there writes nothing.
 */
export async function restoreStoredPartner(
  transaction: TenantTransaction,
  actorUserId: string,
  partnerId: string,
): Promise<Partner> {
  const current = await lockPartner(transaction, partnerId)
  if (current.archivedAt === null)
    return current

  const selected = partnerRows.parse(await writePartner(transaction, sql`
    update app.partners
    set archived_at = null
    where id = ${current.id}
    returning ${partnerColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Partner restore returned no row.')
  const partner = toPartner(row)
  await appendAuditEntry(transaction, {
    action: 'partner.restored',
    actorUserId,
    subjectUserId: null,
    data: { partnerId: current.id },
  })
  return partner
}

function applyPatch(current: Partner, patch: PartnerPatch): Partner {
  return partnerSchema.parse({
    id: current.id,
    name: patch.name === undefined ? current.name : patch.name,
    phone: patch.phone === undefined ? current.phone : patch.phone,
    email: patch.email === undefined ? current.email : patch.email,
    note: patch.note === undefined ? current.note : patch.note,
    archivedAt: current.archivedAt,
  })
}

async function lockPartner(transaction: TenantTransaction, partnerId: string): Promise<Partner> {
  const selected = partnerRows.parse(await readPartner(transaction, sql`
    select ${partnerColumns}
    from app.partners
    where id = ${partnerId}
    for update
  `))
  const row = selected.rows[0]
  if (!row)
    throw new PartnerNotFoundError()
  return toPartner(row)
}

function toPartner(row: z.infer<typeof partnerRowSchema>): Partner {
  return partnerSchema.parse({
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
      throw new Error('Partner archived_at is not a timestamp.')
    return parsed.toISOString()
  }
  throw new Error('Partner archived_at is not a timestamp.')
}

/**
 * Run one read. Every failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown. A phone or a
 * note in that text would otherwise land in the log.
 */
function readPartner(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Partner read failed')
}

/**
 * Run one insert or update. Every failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown.
 */
function writePartner(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Partner write failed')
}
