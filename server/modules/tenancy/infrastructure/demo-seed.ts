import type { PoolClient } from 'pg'
import type { DemoPicture, DemoRide, DemoVehicleKey } from './demo-seed-picture'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import { z } from 'zod'
import { AIRPORT_WAIT_DEFAULT_MINUTES, ELSEWHERE_WAIT_DEFAULT_MINUTES, OPERATIONAL_DAY_START_DEFAULT, passwordLengthLimits, passwordLengthRule, RELOCATION_GAP_DEFAULT_MINUTES, TRANSFER_DURATION_DEFAULT_MINUTES } from '../../../../shared'
import { buildDemoPicture, DEMO_SLUG, DEMO_TENANT_NAME, DEMO_TIME_ZONE } from './demo-seed-picture'

/**
 * Replaces one fictional demo Tenant. The owner connection removes and
 * reinserts app rows. The auth connection owns the accounts. The app role
 * is not used, and it does not gain a DELETE grant.
 * Rows are inserted directly, so an intentional overlap is stored and no
 * mail is sent. Audit rows are not invented. A previous demo audit is
 * removed with the rest of that Tenant, then the append-only trigger is
 * turned back on before commit.
 */

export class DemoSeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoSeedError'
  }
}

export interface SeedDemoTenantInput {
  readonly password: string
  readonly authDatabaseUrl: string
  readonly migrateDatabaseUrl: string
}

const roleRow = z.object({ role: z.string() })

export async function seedDemoTenant(input: SeedDemoTenantInput): Promise<void> {
  if (passwordLengthRule(input.password, passwordLengthLimits) !== null)
    throw new DemoSeedError(`Password must be ${passwordLengthLimits.minPasswordLength} to ${passwordLengthLimits.maxPasswordLength} characters.`)

  const urls = z.object({
    authDatabaseUrl: z.url(),
    migrateDatabaseUrl: z.url(),
  }).safeParse({
    authDatabaseUrl: input.authDatabaseUrl,
    migrateDatabaseUrl: input.migrateDatabaseUrl,
  })
  if (!urls.success)
    throw new DemoSeedError('AUTH_DATABASE_URL and DATABASE_MIGRATE_URL must be set.')

  const picture = buildDemoPicture(new Date())
  const passwordHash = await hashPassword(input.password)

  try {
    await assertRole(urls.data.authDatabaseUrl, 'transferpro_auth')
    await assertRole(urls.data.migrateDatabaseUrl, 'transferpro_owner')
    await assertDemoIdentityIsFree(urls.data.authDatabaseUrl, picture)
    await withClient(urls.data.authDatabaseUrl, client => replaceAuth(client, picture, passwordHash))
    await withClient(urls.data.migrateDatabaseUrl, client => replaceApp(client, picture))
  }
  catch (error) {
    throw hideDatabaseDetail(error)
  }
}

async function assertRole(connectionString: string, expected: 'transferpro_auth' | 'transferpro_owner'): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const result = await pool.query('select current_user as role')
    const role = roleRow.parse(result.rows[0]).role
    if (role !== expected)
      throw new DemoSeedError(`This connection is ${role}. It must be ${expected}.`)
  }
  finally {
    await pool.end()
  }
}

/**
 * Stop before any delete when a demo address or the demo slug belongs to
 * someone else. The message does not name the address.
 */
async function assertDemoIdentityIsFree(connectionString: string, picture: DemoPicture): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const emails = picture.members.map(member => member.email)
    const userIds = picture.members.map(member => member.userId)
    const orgs = await pool.query<{ id: string, slug: string }>(
      'select id, slug from auth.organization where slug = $1 or id = $2',
      [DEMO_SLUG, picture.tenantId],
    )
    for (const org of orgs.rows) {
      if (org.slug === DEMO_SLUG && org.id !== picture.tenantId)
        throw new DemoSeedError('The demo slug belongs to another tenant.')
      if (org.id === picture.tenantId && org.slug !== DEMO_SLUG)
        throw new DemoSeedError('The demo tenant id belongs to another slug.')
    }

    const users = await pool.query<{ id: string, email: string, organization_id: string | null }>(
      `select u.id, lower(u.email) as email, m.organization_id
       from auth."user" as u
       left join auth.member as m on m.user_id = u.id
       where lower(u.email) = any($1::text[]) or u.id = any($2::text[])`,
      [emails, userIds],
    )
    const expectedByEmail = new Map(picture.members.map(member => [member.email, member.userId]))
    for (const user of users.rows) {
      const expectedId = expectedByEmail.get(user.email)
      if (expectedId !== undefined && user.id !== expectedId)
        throw new DemoSeedError('A demo address already belongs to another tenant.')
      if (userIds.includes(user.id) && user.organization_id !== null && user.organization_id !== picture.tenantId)
        throw new DemoSeedError('A demo address already belongs to another tenant.')
    }

    const invitations = await pool.query(
      `select 1 from auth.invitation
       where inviter_id = any($1::text[]) and organization_id <> $2
       limit 1`,
      [userIds, picture.tenantId],
    )
    if ((invitations.rowCount ?? 0) > 0)
      throw new DemoSeedError('A demo member is the inviter for another tenant.')
  }
  finally {
    await pool.end()
  }
}

async function replaceAuth(client: PoolClient, picture: DemoPicture, passwordHash: string): Promise<void> {
  const userIds = picture.members.map(member => member.userId)
  await client.query('delete from auth.organization where id = $1', [picture.tenantId])
  await client.query('delete from auth."user" where id = any($1::text[])', [userIds])

  for (const member of picture.members) {
    await client.query(
      `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, true, now(), now())`,
      [member.userId, member.name, member.email],
    )
    await client.query(
      `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $2, $3, now(), now())`,
      [member.accountId, member.userId, passwordHash],
    )
  }
  await client.query(
    `insert into auth.organization (id, name, slug, created_at)
     values ($1, $2, $3, now())`,
    [picture.tenantId, DEMO_TENANT_NAME, DEMO_SLUG],
  )
  for (const member of picture.members) {
    await client.query(
      `insert into auth.member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, $4, now())`,
      [member.memberId, picture.tenantId, member.userId, member.role],
    )
  }
}

async function replaceApp(client: PoolClient, picture: DemoPicture): Promise<void> {
  const tenantId = picture.tenantId
  await client.query('delete from app.mail_outbox where tenant_id = $1', [tenantId])
  await client.query('delete from app.ride_alert where tenant_id = $1', [tenantId])
  await client.query('delete from app.rides where tenant_id = $1', [tenantId])
  await client.query('delete from app.transfers where tenant_id = $1', [tenantId])
  await client.query('delete from app.roster where tenant_id = $1', [tenantId])
  await client.query('delete from app.drivers where tenant_id = $1', [tenantId])
  await client.query('delete from app.vehicles where tenant_id = $1', [tenantId])
  await client.query('delete from app.locations where tenant_id = $1', [tenantId])
  await client.query('delete from app.clients where tenant_id = $1', [tenantId])
  // Audit is append-only, including for the owner. This command writes none
  // and does not disable the trigger. Rows from a real session stay.
  await client.query('delete from app.tenant_settings where tenant_id = $1', [tenantId])

  await client.query(
    `insert into app.tenant_settings (
       tenant_id, default_locale, time_zone, airport_wait_minutes, elsewhere_wait_minutes,
       operational_day_start_hour, transfer_duration_minutes, relocation_gap_minutes
     )
     values ($1, 'hr', $2, $3, $4, $5, $6, $7)`,
    [
      tenantId,
      DEMO_TIME_ZONE,
      AIRPORT_WAIT_DEFAULT_MINUTES,
      ELSEWHERE_WAIT_DEFAULT_MINUTES,
      OPERATIONAL_DAY_START_DEFAULT,
      TRANSFER_DURATION_DEFAULT_MINUTES,
      RELOCATION_GAP_DEFAULT_MINUTES,
    ],
  )

  for (const clientRow of picture.clients) {
    await client.query(
      `insert into app.clients (tenant_id, id, name, kind) values ($1, $2, $3, $4)`,
      [tenantId, clientRow.id, clientRow.name, clientRow.kind],
    )
  }
  for (const location of picture.locations) {
    await client.query(
      `insert into app.locations (tenant_id, id, name, kind, address, iata)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenantId, location.id, location.name, location.kind, location.address, location.iata],
    )
  }
  for (const vehicle of picture.vehicles) {
    const registration = vehicle.key === 'expired' ? picture.registrationExpiredOn : picture.documentsValidOn
    await client.query(
      `insert into app.vehicles (
         tenant_id, id, registration_plate, kind, registration_expires_on,
         technical_inspection_expires_on, insurance_expires_on, archived_at
       )
       values ($1, $2, $3, 'fixed', $4, $5, $5, $6)`,
      [
        tenantId,
        vehicle.id,
        vehicle.plate,
        registration,
        picture.documentsValidOn,
        vehicle.archived ? picture.archivedAt : null,
      ],
    )
  }

  // The driver trigger reads app.tenant_member, which follows the session tenant.
  await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
  for (const member of picture.members) {
    if (member.driver === null || member.phone === null)
      continue
    await client.query(
      `insert into app.drivers (
         tenant_id, id, name, kind, phone, email, driving_licence_expires_on,
         transport_licence_expires_on, member_user_id, must_accept
       )
       values ($1, $2, $3, 'own', $4, $5, $6, $6, $7, $8)`,
      [
        tenantId,
        picture.driverIds[member.driver],
        member.name,
        member.phone,
        member.email,
        picture.documentsValidOn,
        member.userId,
        member.mustAccept,
      ],
    )
  }

  for (const row of picture.rides)
    await insertRide(client, picture, row)

  for (const row of picture.roster) {
    await client.query(
      `insert into app.roster (tenant_id, id, roster_date, driver_id, vehicle_id)
       values ($1, $2, $3, $4, $5)`,
      [tenantId, row.id, row.rosterDate, picture.driverIds[row.driver], vehicleId(picture, row.vehicle)],
    )
  }
}

async function insertRide(client: PoolClient, picture: DemoPicture, row: DemoRide): Promise<void> {
  const clientId = picture.clients.find(item => item.key === row.client)?.id
  const startId = picture.locations.find(item => item.key === row.start)?.id
  const endId = picture.locations.find(item => item.key === row.end)?.id
  if (clientId === undefined || startId === undefined || endId === undefined)
    throw new DemoSeedError('Could not seed the demo tenant.')

  await client.query(
    `insert into app.transfers (
       tenant_id, id, client_id, pickup_at, start_location_id, end_location_id,
       passenger_count, guest_name, flight_number, landing_at, price, payment,
       airport_mark, luggage_count, child_seat_count, note, tabla
     )
     values ($1, $2, $3, $4, $5, $6, 2, $7, $8, $9, $10, $11, $12, 1, 0, $13, $14)`,
    [
      picture.tenantId,
      row.transferId,
      clientId,
      row.pickupAt,
      startId,
      endId,
      row.guestName,
      row.flightNumber,
      row.landingAt,
      row.price,
      row.payment,
      row.airportMark,
      row.note,
      row.tabla,
    ],
  )
  await client.query(
    `insert into app.rides (tenant_id, id, transfer_id, state, driver_id, vehicle_id, must_accept)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      picture.tenantId,
      row.rideId,
      row.transferId,
      row.state,
      row.driver === null ? null : picture.driverIds[row.driver],
      row.vehicle === null ? null : vehicleId(picture, row.vehicle),
      row.mustAccept,
    ],
  )
  if (row.declinedBy !== null && row.alertId !== null) {
    await client.query(
      `insert into app.ride_alert (tenant_id, id, ride_id, driver_id, kind)
       values ($1, $2, $3, $4, 'declined')`,
      [picture.tenantId, row.alertId, row.rideId, picture.driverIds[row.declinedBy]],
    )
  }
}

function vehicleId(picture: DemoPicture, key: DemoVehicleKey): string {
  const vehicle = picture.vehicles.find(item => item.key === key)
  if (vehicle === undefined)
    throw new DemoSeedError('Could not seed the demo tenant.')
  return vehicle.id
}

async function withClient(connectionString: string, run: (client: PoolClient) => Promise<void>): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const client = await pool.connect()
    try {
      await client.query('begin')
      try {
        await run(client)
        await client.query('commit')
      }
      catch (error) {
        await client.query('rollback')
        throw hideDatabaseDetail(error)
      }
    }
    finally {
      client.release()
    }
  }
  finally {
    await pool.end()
  }
}

/**
 * A Postgres detail can carry a name or an address. The operator sees a
 * fixed sentence. A refusal we already wrote is kept.
 */
function hideDatabaseDetail(error: unknown): DemoSeedError {
  if (error instanceof DemoSeedError)
    return error
  return new DemoSeedError('Could not seed the demo tenant.')
}
