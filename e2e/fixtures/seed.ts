import process from 'node:process'
import pg from 'pg'
import { createSuperadmin } from '../../server/modules/platform'
import { createTenant } from '../../server/modules/tenancy'
import { insertCredentialMemberConnecting, insertCredentialUserConnecting } from '../../server/modules/tenancy/testing'

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
