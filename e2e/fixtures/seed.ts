import process from 'node:process'
import pg from 'pg'
import { assertE2eDatabaseEnv } from '../../scripts/e2e-database.mjs'
import { createSuperadmin } from '../../server/modules/platform'
import { createTenant } from '../../server/modules/tenancy'
import { insertCredentialMemberConnecting, insertCredentialUserConnecting, insertMembership } from '../../server/modules/tenancy/testing'

// node-pg prefers ?host and ?hostaddr over the host in the URL.
// Refuse before any seed function opens a connection.
assertE2eDatabaseEnv(process.env)

/** Shared by every seeded account. Inside the auth password bounds. */
export const memberPassword = 'e2e-member-password'

export interface SeededTenant {
  readonly tenantId: string
  readonly name: string
  readonly slug: string
  readonly adminEmail: string
  readonly adminName: string
  readonly password: string
}

export interface SeededMember {
  readonly email: string
  readonly name: string
  readonly password: string
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

function id(): string {
  return crypto.randomUUID()
}

/** One Tenant and its admin. The slug and the email are unique because the audit log is append-only. */
export async function seedTenant(label: string): Promise<SeededTenant> {
  const suffix = id()
  const name = `E2E ${label} ${suffix.slice(0, 8)}`
  const slug = `e2e-${label}-${suffix}`
  const adminEmail = `e2e-${label}-${suffix}@example.test`
  const adminName = `Admin ${label}`
  const created = await createTenant({
    name,
    slug,
    adminEmail,
    adminName,
    password: memberPassword,
    authDatabaseUrl: required('AUTH_DATABASE_URL'),
    migrateDatabaseUrl: required('DATABASE_MIGRATE_URL'),
  })
  return {
    tenantId: created.tenantId,
    name,
    slug,
    adminEmail,
    adminName,
    password: memberPassword,
  }
}

/** A credential member, using the same insert as the member-management RLS tests. */
export async function seedMember(tenantId: string, role: 'admin' | 'dispatcher' | 'driver', label: string): Promise<SeededMember & { readonly userId: string }> {
  const suffix = id()
  // The label may contain č or š. The browser rejects those in an email field.
  const email = `e2e-${role}-${suffix}@example.test`
  const name = `${label} ${suffix.slice(0, 8)}`
  const userId = await insertCredentialMemberConnecting(required('AUTH_DATABASE_URL'), tenantId, {
    email,
    name,
    password: memberPassword,
    role,
  })
  return { userId, email, name, password: memberPassword }
}

/**
 * A second membership for someone who already has an account.
 * The gate lists it when the Tenant is working.
 */
export async function seedMembership(tenantId: string, email: string, role: 'admin' | 'dispatcher' | 'driver'): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('AUTH_DATABASE_URL'), max: 1 })
  try {
    const found = await pool.query<{ id: string }>(
      'select id from auth."user" where lower(email) = $1',
      [email.toLowerCase()],
    )
    const userId = found.rows[0]?.id
    if (!userId)
      throw new Error('Membership seed has no account.')
    await insertMembership(pool, tenantId, userId, role)
  }
  finally {
    await pool.end()
  }
}

/** A credential user with no membership. Sign-in then shows the no-access message. */
export async function seedUserWithoutMembership(label: string): Promise<SeededMember> {
  const suffix = id()
  const email = `e2e-none-${label}-${suffix}@example.test`
  const name = `None ${suffix.slice(0, 8)}`
  await insertCredentialUserConnecting(required('AUTH_DATABASE_URL'), {
    email,
    name,
    password: memberPassword,
  })
  return { email, name, password: memberPassword }
}

/** A platform owner. No organization and no membership. */
export async function seedSuperadmin(label: string): Promise<SeededMember> {
  const suffix = id()
  const email = `e2e-platform-${label}-${suffix}@example.test`
  const name = `Platform ${label}`
  await createSuperadmin({
    name,
    email,
    password: memberPassword,
    migrateDatabaseUrl: required('DATABASE_MIGRATE_URL'),
  })
  return { email, name, password: memberPassword }
}

/**
 * Rows a platform screen must never show. The owner writes them because
 * current_tenant_id() is null on that connection.
 */
export async function plantOperationalRows(tenantId: string): Promise<{ clientName: string, driverName: string, vehicleDescription: string }> {
  const clientName = 'PlantedClient'
  const driverName = 'PlantedDriver'
  const vehicleDescription = 'PlantedVehicle'
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    await pool.query(
      `insert into app.clients (tenant_id, name, kind) values ($1, $2, 'agency')`,
      [tenantId, clientName],
    )
    await pool.query(
      `insert into app.drivers (tenant_id, name, kind, phone, driving_licence_expires_on, transport_licence_expires_on)
       values ($1, $2, 'own', '+385911112233', '2030-06-01', '2030-06-01')`,
      [tenantId, driverName],
    )
    await pool.query(
      `insert into app.vehicles (
         tenant_id, registration_plate, kind, registration_expires_on,
         technical_inspection_expires_on, insurance_expires_on, description
       ) values ($1, 'E2EVH01', 'fixed', '2030-06-01', '2030-06-01', '2030-06-01', $2)`,
      [tenantId, vehicleDescription],
    )
  }
  finally {
    await pool.end()
  }
  return { clientName, driverName, vehicleDescription }
}

/**
 * One Driver row, written by the owner. `set_config` lets the member trigger
 * see this Tenant's driver. A missing member id is a Driver with no account.
 */
export async function seedDriverRecord(tenantId: string, input: {
  readonly name: string
  readonly phone: string
  readonly drivingLicenceExpiresOn: string
  readonly transportLicenceExpiresOn: string
  readonly memberUserId?: string
}): Promise<void> {
  let email: string | null = null
  if (input.memberUserId !== undefined) {
    const auth = new pg.Pool({ connectionString: required('AUTH_DATABASE_URL'), max: 1 })
    try {
      const found = await auth.query<{ email: string }>('select email from auth."user" where id = $1', [input.memberUserId])
      email = found.rows[0]?.email ?? null
    }
    finally {
      await auth.end()
    }
    if (email === null)
      throw new Error('Seeded Driver has no sign-in email.')
  }
  await withOwnerTransaction(tenantId, async (client) => {
    await client.query(
      `insert into app.drivers (
         tenant_id, name, kind, phone, email,
         driving_licence_expires_on, transport_licence_expires_on, member_user_id
       ) values ($1, $2, 'own', $3, $4, $5, $6, $7)`,
      [
        tenantId,
        input.name,
        input.phone,
        email,
        input.drivingLicenceExpiresOn,
        input.transportLicenceExpiresOn,
        input.memberUserId ?? null,
      ],
    )
  })
}

/** One Vehicle row. `archived` sets archived_at so the dashboard leaves it off. */
export async function seedVehicleRecord(tenantId: string, input: {
  readonly registrationPlate: string
  readonly registrationExpiresOn: string
  readonly technicalInspectionExpiresOn: string
  readonly insuranceExpiresOn: string
  readonly archived?: boolean
}): Promise<void> {
  await withOwnerTransaction(tenantId, async (client) => {
    await client.query(
      `insert into app.vehicles (
         tenant_id, registration_plate, kind,
         registration_expires_on, technical_inspection_expires_on, insurance_expires_on,
         archived_at
       ) values ($1, $2, 'fixed', $3, $4, $5, $6)`,
      [
        tenantId,
        input.registrationPlate,
        input.registrationExpiresOn,
        input.technicalInspectionExpiresOn,
        input.insuranceExpiresOn,
        input.archived === true ? new Date() : null,
      ],
    )
  })
}

/**
 * A failed work order, as the retry worker would leave it.
 * The e2e clock does not move that worker, so the Home spec plants the row.
 * `created_at` is a second ahead of an assign that just committed, so that
 * earlier mail does not make this one stale.
 */
export async function plantFailedWorkOrder(tenantId: string, input: {
  readonly rideId: string
  readonly driverId: string
  readonly status?: 'assigned' | 'changed' | 'cancelled' | 'no_longer_yours'
  readonly vehicleId?: string | null
}): Promise<string> {
  const status = input.status ?? 'assigned'
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const inserted = await client.query<{ id: string }>(
      `insert into app.mail_outbox (
         tenant_id, kind, ride_id, driver_id, vehicle_id, work_order_status, state, attempt_count, created_at
       ) values ($1, 'work_order', $2, $3, $4, $5, 'failed', 4, now() + interval '1 second')
       returning id`,
      [tenantId, input.rideId, input.driverId, status === 'no_longer_yours' ? input.vehicleId ?? null : null, status],
    )
    const id = inserted.rows[0]?.id
    if (id === undefined)
      throw new Error('Failed work order was not planted.')
    await client.query('commit')
    return id
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
    await pool.end()
  }
}

/**
 * The automatic invitation retries take about 36 minutes. This leaves the
 * row they would: the invitation's entry, failed after four attempts.
 * The id comes from the link the dialog showed. It is not logged.
 */
export async function failInvitationMail(tenantId: string, invitationId: string): Promise<void> {
  await withOwnerTransaction(tenantId, async (client) => {
    const updated = await client.query(
      `update app.mail_outbox
       set state = 'failed', attempt_count = 4, next_attempt_at = null
       where tenant_id = $1 and kind = 'invitation' and invitation_id = $2`,
      [tenantId, invitationId],
    )
    if (updated.rowCount !== 1)
      throw new Error('Invitation mail was not marked failed.')
  })
}

async function withOwnerTransaction(tenantId: string, write: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    await write(client)
    await client.query('commit')
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
    await pool.end()
  }
}
