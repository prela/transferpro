import type { SQL } from 'drizzle-orm'
import type { CreateDriver, Driver, DriverField, DriverPatch } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { DRIVER_FIELDS, driverDateSchema, driverEmailSchema, DriverInputError, driverKindSchema, driverSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { TenantAccessError } from '../../tenancy'

const driverRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: driverKindSchema,
  phone: z.string(),
  email: driverEmailSchema.nullable(),
  drivingLicenceExpiresOn: driverDateSchema,
  transportLicenceExpiresOn: driverDateSchema,
  memberUserId: z.string().nullable(),
  mustAccept: z.boolean(),
})

const driverRows = z.object({
  rows: z.array(driverRowSchema),
})

const memberRows = z.object({
  rows: z.array(z.object({ role: z.string() })),
})

/** The Driver is not in this Tenant. Another Tenant's row looks the same. */
export class DriverNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'DriverNotFoundError'
  }
}

const driverColumns = sql`
  id, name, kind, phone, email,
  driving_licence_expires_on::text as "drivingLicenceExpiresOn",
  transport_licence_expires_on::text as "transportLicenceExpiresOn",
  member_user_id as "memberUserId",
  must_accept as "mustAccept"
`

/**
 * Whether this Tenant has that Driver.
 * Another Tenant's id is absent: the select runs under the session's row security.
 * The roster module calls this through the Drivers index, by id.
 */
export async function driverIsInTenant(transaction: TenantTransaction, driverId: string): Promise<boolean> {
  const selected = z.object({
    rows: z.array(z.object({ id: z.uuid() })),
  }).parse(await transaction.execute(sql`
    select id
    from app.drivers
    where id = ${driverId}
  `))
  return selected.rows.length === 1
}

/**
 * The must-accept flag of this Tenant's Driver, or null when the id is absent,
 * and a `for share` lock on that row.
 * Assignment copies this boolean onto the Ride. A correction of must-accept
 * takes `for update`, so it cannot commit a different value before the Ride
 * update on this transaction. The phone and the licence dates stay unread.
 * Another Tenant's id is null: the select runs under the session's row security.
 * `loadDrivers` does not lock. This read is only for the assign transaction.
 */
export async function driverMustAcceptForAssign(transaction: TenantTransaction, driverId: string): Promise<boolean | null> {
  const selected = z.object({
    rows: z.array(z.object({ mustAccept: z.boolean() })),
  }).parse(await readDriverForAssign(transaction, sql`
    select must_accept as "mustAccept"
    from app.drivers
    where id = ${driverId}
    for share
  `))
  return selected.rows[0]?.mustAccept ?? null
}

/**
 * This Tenant's Drivers, by name, so the office can find one.
 * There is no inactive or archived Driver column, so this is every row.
 */
export async function loadDrivers(transaction: TenantTransaction): Promise<Driver[]> {
  const selected = driverRows.parse(await transaction.execute(sql`
    select ${driverColumns}
    from app.drivers
    order by name, id
  `))
  return selected.rows.map(toDriver)
}

/**
 * The Driver linked to this member, or none.
 * The expiry list uses this so a driver member's query does not select
 * other Drivers' licence dates. The office list stays `loadDrivers`.
 */
export async function loadDriverLinkedToMember(transaction: TenantTransaction, memberUserId: string): Promise<Driver[]> {
  const selected = driverRows.parse(await transaction.execute(sql`
    select ${driverColumns}
    from app.drivers
    where member_user_id = ${memberUserId}
    order by name, id
  `))
  return selected.rows.map(toDriver)
}

/**
 * Insert one Driver and append `driver.created` on this transaction.
 * The entry names the fields that were set. It does not store the phone,
 * the email, the licence dates, or the kind. Must-accept stays off: the
 * column default writes false, and that default is not a field the caller set.
 * A linked Driver stores the sign-in email. The caller reads that address
 * with the auth role, the same pool that reads an invitation email.
 * The app role does not select auth.user.
 * The caller has already required a dispatcher or an admin.
 */
export async function addDriver(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreateDriver,
  readSignInEmail: (userId: string) => Promise<string | null> = async () => null,
): Promise<Driver> {
  // The parser already refuses an address on a linked create. Repeat it here
  // so a caller that skips the parser cannot store a second address.
  if (input.memberUserId !== undefined && input.email !== undefined)
    throw new DriverInputError()
  const email = input.memberUserId === undefined
    ? input.email ?? null
    : await linkedSignInEmail(transaction, input.memberUserId, readSignInEmail)

  const selected = driverRows.parse(await writeDriver(transaction, sql`
    insert into app.drivers (
      name, kind, phone, email,
      driving_licence_expires_on, transport_licence_expires_on,
      member_user_id
    )
    values (
      ${input.name}, ${input.kind}, ${input.phone}, ${email},
      ${input.drivingLicenceExpiresOn}, ${input.transportLicenceExpiresOn},
      ${input.memberUserId ?? null}
    )
    returning ${driverColumns}
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Driver insert returned no row.')
  const driver = toDriver(row)
  await appendAuditEntry(transaction, {
    action: 'driver.created',
    actorUserId,
    subjectUserId: null,
    data: { driverId: driver.id, fields: createdFields(input, email !== null) },
  })
  return driver
}

/**
 * Correct the fields the patch names. One entry per field that changed,
 * and the entry stores the field name only. An email change names `email`
 * and does not store the address.
 * A patch that matches the locked row does not update and does not append.
 * A dispatcher who tries to change must-accept is refused before the update,
 * so the other fields in that patch are not written either.
 * An address on a Driver who has, or will have, an account is refused and
 * nothing is written. Linking copies the sign-in email over the stored one.
 * Unlinking leaves the address in place.
 * A missing row is not found, including a row that belongs to another Tenant.
 */
export async function correctDriver(
  transaction: TenantTransaction,
  actorUserId: string,
  role: string,
  driverId: string,
  patch: DriverPatch,
  readSignInEmail: (userId: string) => Promise<string | null> = async () => null,
): Promise<Driver> {
  const current = await lockDriver(transaction, driverId)
  let next = applyPatch(current, patch)
  if (next.mustAccept !== current.mustAccept && role !== 'admin')
    throw new TenantAccessError(403)
  // The resulting row has an account, so the body may not choose the address.
  if (patch.email !== undefined && next.memberUserId !== null)
    throw new DriverInputError()
  if (next.memberUserId !== null && next.memberUserId !== current.memberUserId) {
    const email = await linkedSignInEmail(transaction, next.memberUserId, readSignInEmail)
    next = driverSchema.parse({ ...next, email })
  }

  const fields = changedFields(current, next)
  if (fields.length === 0)
    return current

  await writeDriver(transaction, sql`
    update app.drivers
    set name = ${next.name},
        kind = ${next.kind},
        phone = ${next.phone},
        email = ${next.email},
        driving_licence_expires_on = ${next.drivingLicenceExpiresOn},
        transport_licence_expires_on = ${next.transportLicenceExpiresOn},
        member_user_id = ${next.memberUserId},
        must_accept = ${next.mustAccept}
    where id = ${next.id}
  `)

  for (const field of fields) {
    await appendAuditEntry(transaction, {
      action: 'driver.field_changed',
      actorUserId,
      subjectUserId: null,
      data: { driverId: current.id, field },
    })
  }
  return next
}

/**
 * One address from the auth role. A missing account, or an address this
 * schema refuses, is a bad request. A thrown reader is replaced: its message
 * can carry the address.
 */
async function signInEmail(
  userId: string,
  readSignInEmail: (userId: string) => Promise<string | null>,
): Promise<string> {
  let email: string | null
  try {
    email = await readSignInEmail(userId)
  }
  catch {
    throw new Error('Driver read failed')
  }
  const parsed = driverEmailSchema.safeParse(email)
  if (!parsed.success)
    throw new DriverInputError()
  return parsed.data
}

/**
 * The member must be a driver of this Tenant. `app.tenant_member` is empty
 * for a user who belongs only to another Tenant, so the same check refuses
 * a cross-tenant link. The database trigger repeats it for a write that
 * skips this function.
 */
async function requireDriverMember(transaction: TenantTransaction, userId: string): Promise<void> {
  const selected = memberRows.parse(await transaction.execute(sql`
    select role
    from app.tenant_member
    where user_id = ${userId}
  `))
  const row = selected.rows[0]
  if (selected.rows.length !== 1 || row?.role !== 'driver')
    throw new DriverInputError()
}

function createdFields(input: CreateDriver, emailStored: boolean): DriverField[] {
  const fields: DriverField[] = ['name', 'kind', 'phone']
  // A blank address is the column default, the same way must-accept starts off.
  if (emailStored)
    fields.push('email')
  fields.push('drivingLicenceExpiresOn', 'transportLicenceExpiresOn')
  if (input.memberUserId !== undefined)
    fields.push('memberUserId')
  return fields
}

/**
 * The member must be a driver of this Tenant, and the address is that
 * member's sign-in email. The member check uses `app.tenant_member`.
 * The address comes from the auth role, not from a view the app role can select.
 */
async function linkedSignInEmail(
  transaction: TenantTransaction,
  userId: string,
  readSignInEmail: (userId: string) => Promise<string | null>,
): Promise<string> {
  await requireDriverMember(transaction, userId)
  return signInEmail(userId, readSignInEmail)
}

function changedFields(current: Driver, next: Driver): DriverField[] {
  return DRIVER_FIELDS.filter(field => next[field] !== current[field])
}

function applyPatch(current: Driver, patch: DriverPatch): Driver {
  return driverSchema.parse({
    id: current.id,
    name: patch.name === undefined ? current.name : patch.name,
    kind: patch.kind === undefined ? current.kind : patch.kind,
    phone: patch.phone === undefined ? current.phone : patch.phone,
    email: patch.email === undefined ? current.email : patch.email,
    drivingLicenceExpiresOn: patch.drivingLicenceExpiresOn === undefined
      ? current.drivingLicenceExpiresOn
      : patch.drivingLicenceExpiresOn,
    transportLicenceExpiresOn: patch.transportLicenceExpiresOn === undefined
      ? current.transportLicenceExpiresOn
      : patch.transportLicenceExpiresOn,
    memberUserId: patch.memberUserId === undefined ? current.memberUserId : patch.memberUserId,
    mustAccept: patch.mustAccept === undefined ? current.mustAccept : patch.mustAccept,
  })
}

async function lockDriver(transaction: TenantTransaction, driverId: string): Promise<Driver> {
  const selected = driverRows.parse(await transaction.execute(sql`
    select ${driverColumns}
    from app.drivers
    where id = ${driverId}
    for update
  `))
  const row = selected.rows[0]
  if (!row)
    throw new DriverNotFoundError()
  return toDriver(row)
}

function toDriver(row: z.infer<typeof driverRowSchema>): Driver {
  return driverSchema.parse(row)
}

/**
 * Run the assign read. Every failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown. A driver id
 * in that text would otherwise land in the log.
 */
function readDriverForAssign(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Driver read failed')
}

/**
 * Run one insert or update. A unique member link, or the trigger refusing a
 * member, is a bad request. Every other failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown.
 */
async function writeDriver(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  try {
    return await transaction.execute(query)
  }
  catch (error) {
    if (isMemberConstraint(error))
      throw new DriverInputError()
    throw new Error('Driver write failed')
  }
}

/**
 * Drizzle wraps the Postgres error. The outer message includes the bound
 * parameters, so it is never rethrown: a phone in that text would be logged.
 */
function isMemberConstraint(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = 'code' in current ? current.code : undefined
    const message = 'message' in current && typeof current.message === 'string' ? current.message : ''
    if (code === '23505')
      return true
    if (code === '23514' && message.includes('driver member is not a driver of this tenant'))
      return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
