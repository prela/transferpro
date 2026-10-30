import type { Mailer } from '../../tenancy'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { openTenantSession } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { createClient } from '../../clients'
import { createDriver } from '../../drivers'
import { createLocation } from '../../locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../../tenancy'
import { assignRide, changeVehicle, clearRide, closeMailOutboxQueue, createTransfer, mailOutboxQueue, outboxAttemptStore, reassignRide } from '../../transfers'
import { createVehicle } from '../../vehicles'
import { enqueueMailOutboxJob, handleMailOutboxJob, recordWorkOrder } from '../index'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * Outbox seam: the entry is written on the caller's transaction and the
 * first attempt is what the fake mailer received. A fake session cannot
 * prove Tenant A is hidden from Tenant B. The observation is the rows.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const databaseUrl = required('DATABASE_URL')
const authUrl = required('BETTER_AUTH_URL')
const password = 'outbox-http-password'
const address = 'ana-outbox@example.test'

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const appDb = drizzle(appPool)

class RolledBack extends Error {
  constructor() {
    super('rollback')
    this.name = 'RolledBack'
  }
}

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'mbox-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'mbox-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'mbox-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'mbox-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'mbox-%'`)
    await auth.query('commit')
  }
  catch (error) {
    await owner.query('rollback')
    await auth.query('rollback')
    throw error
  }
  finally {
    owner.release()
    auth.release()
  }
})

afterAll(async () => {
  // Jobs from this file name only mbox tenants. Drop them so a dev worker
  // does not deliver a fixture. The owner role can see both schemas.
  await ownerPool.query(`delete from pgboss.job
    where name = 'mail-outbox'
      and data->>'tenantId' in (
        select id::text from auth.organization where slug like 'mbox-%'
      )`)
  await closeMailOutboxQueue()
  await closeTenantRuntime()
  await authPool.end()
  await ownerPool.end()
  await appPool.end()
})

async function signIn(email: string): Promise<Headers> {
  const response = await handleAuthRequest(new Request(new URL('/api/auth/sign-in/email', authUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
  if (!response.ok)
    throw new Error(`sign-in status ${response.status}`)
  return new Headers({ cookie: response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ') })
}

async function office(slug: string) {
  const created = await createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName: 'Hana Admin',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const dispatcherEmail = `${slug}-dispatcher@example.test`
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Dino Dispatcher', $2, true, now(), now())`,
    [userId, dispatcherEmail],
  )
  await authPool.query(
    `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), userId, await hashPassword(password)],
  )
  await authPool.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, 'dispatcher', now())`,
    [crypto.randomUUID(), created.tenantId, userId],
  )
  const dispatcher = await signIn(dispatcherEmail)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  return { ...created, dispatcher, client, start, end }
}

function transferBody(world: Awaited<ReturnType<typeof office>>) {
  return {
    // Fresh entry key. The create stays idempotent once the key is required.
    externalId: crypto.randomUUID(),
    clientId: world.client.id,
    pickupAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    startLocationId: world.start.id,
    endLocationId: world.end.id,
    passengerCount: 1,
    guestName: 'Gost Tajna',
    price: 10,
    payment: 'cash' as const,
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  }
}

function mailer(send: Mailer['sendWorkOrder']): Mailer {
  return {
    async sendInvitation() {},
    sendWorkOrder: send,
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged() {},
    async sendPasswordReset() {},
  }
}

interface OutboxRow {
  id: string
  kind: string
  state: string
  attempt_count: number
  work_order_status: string | null
  invitation_id: string | null
  ride_id: string | null
  driver_id: string | null
  vehicle_id: string | null
  next_attempt_at: Date | null
}

async function rowsFor(rideId: string): Promise<OutboxRow[]> {
  const result = await ownerPool.query<OutboxRow>(
    `select id, kind, state, attempt_count, work_order_status, invitation_id, ride_id, driver_id, vehicle_id, next_attempt_at
     from app.mail_outbox where ride_id = $1 order by created_at, id`,
    [rideId],
  )
  return result.rows
}

async function withAppTenant<T>(tenantId: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantId])
    const result = await run(client)
    await client.query('commit')
    return result
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}

it('forces row level security and stores no address, name, subject, or body', async () => {
  const client = await appPool.connect()
  try {
    const seen = await client.query<{ relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'mail_outbox'`,
    )
    expect(seen.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
    const columns = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'app' and table_name = 'mail_outbox'
       order by column_name`,
    )
    expect(columns.rows.map(row => row.column_name)).toEqual([
      'attempt_count',
      'created_at',
      'driver_id',
      'id',
      'invitation_id',
      'kind',
      'next_attempt_at',
      'ride_id',
      'state',
      'tenant_id',
      'vehicle_id',
      'work_order_status',
    ])
  }
  finally {
    client.release()
  }
})

it('rolls the entry back with the Ride transaction, then a sent attempt marks it sent', async () => {
  const world = await office('mbox-send')
  const driver = await createDriver(world.dispatcher, {
    name: 'Ana Outbox',
    kind: 'own',
    phone: '+385911113301',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))

  const queue = await mailOutboxQueue()
  let written = ''
  await expect(appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: world.tenantId }, async () => {
      const id = await recordWorkOrder(transaction, {
        rideId: recorded.ride.id,
        driverId: driver.id,
        vehicleId: null,
        status: 'assigned',
        email: address,
      }, new Date(Date.now() + 60_000))
      expect(id).toEqual(expect.any(String))
      written = id ?? ''
      await enqueueMailOutboxJob(queue, { tenantId: world.tenantId }, transaction, written, new Date(Date.now() + 60_000))
    })
    throw new RolledBack()
  })).rejects.toBeInstanceOf(RolledBack)
  expect(await rowsFor(recorded.ride.id)).toEqual([])
  const kept = await ownerPool.query('select id from pgboss.job where data #>> \'{data,entryId}\' = $1', [written])
  expect(kept.rows).toEqual([])

  const sent: string[] = []
  const assigned = await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: 0,
  }, {
    mailer: mailer(async (mail) => {
      sent.push(mail.to)
    }),
  })
  expect(assigned.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent).toEqual([address])
  const [row] = await rowsFor(recorded.ride.id)
  expect(row).toMatchObject({
    kind: 'work_order',
    state: 'sent',
    attempt_count: 1,
    work_order_status: 'assigned',
    invitation_id: null,
    ride_id: recorded.ride.id,
    driver_id: driver.id,
    vehicle_id: null,
    next_attempt_at: null,
  })
  expect(JSON.stringify(row)).not.toContain(address)
  expect(JSON.stringify(assigned)).not.toContain(address)
})

it('leaves a failed first attempt pending and logs the entry, the Ride, and the Driver', async () => {
  const world = await office('mbox-fail')
  const driver = await createDriver(world.dispatcher, {
    name: 'Ana Fail',
    kind: 'own',
    phone: '+385911113302',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330BB',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  const logs = captureLogs()
  const failed = await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: 0,
  }, {
    logger: logs.logger,
    mailer: mailer(async () => {
      throw new Error(`rejected ${address} Gost Tajna`)
    }),
  })
  expect(failed.workOrders).toEqual([{ driverId: driver.id, outcome: 'failed' }])
  const [row] = await rowsFor(recorded.ride.id)
  expect(row).toMatchObject({
    state: 'pending',
    attempt_count: 1,
    work_order_status: 'assigned',
  })
  expect(row?.next_attempt_at).toBeInstanceOf(Date)
  const [line] = logs.lines()
  expect(line).toMatchObject({
    event: 'work_order.email_failed',
    entryId: row?.id,
    rideId: recorded.ride.id,
    driverId: driver.id,
    err: { type: 'Error' },
  })
  const text = JSON.stringify(line)
  expect(text).not.toContain(address)
  expect(text).not.toContain('Gost Tajna')
  const queued = await ownerPool.query<{ start_after: Date }>(
    'select start_after from pgboss.job where name = $1 and data #>> \'{data,entryId}\' = $2',
    ['mail-outbox', row?.id],
  )
  expect(queued.rows).toHaveLength(1)
  const due = queued.rows[0]?.start_after
  expect(due).toBeInstanceOf(Date)
  const wait = (due?.getTime() ?? 0) - Date.now()
  expect(wait).toBeGreaterThan(20_000)
  expect(wait).toBeLessThan(90_000)
})

it('stores the released vehicle on no longer yours and leaves the assigned row without one', async () => {
  const world = await office('mbox-vehicle')
  const driver = await createDriver(world.dispatcher, {
    name: 'Ana Released',
    kind: 'own',
    phone: '+385911113305',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330EE',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: 0,
  }, {
    mailer: mailer(async () => {}),
  })
  const version = await ownerPool.query<{ version: number }>(
    `select t.version
     from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [recorded.ride.id],
  )
  await clearRide(world.dispatcher, recorded.ride.id, { version: Number(version.rows[0]?.version) }, {
    mailer: mailer(async () => {}),
  })
  const rows = await rowsFor(recorded.ride.id)
  expect(rows).toEqual([
    expect.objectContaining({ work_order_status: 'assigned', vehicle_id: null }),
    expect.objectContaining({ work_order_status: 'no_longer_yours', vehicle_id: vehicle.id }),
  ])
  expect(JSON.stringify(rows)).not.toContain('ZG9330EE')
})

it('refuses an assigned work order that names a vehicle', async () => {
  const world = await office('mbox-shape')
  const driver = await createDriver(world.dispatcher, {
    name: 'Ana Shape',
    kind: 'own',
    phone: '+385911113306',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330FF',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  await expect(withAppTenant(world.tenantId, client =>
    client.query(
      `insert into app.mail_outbox (
         kind, ride_id, driver_id, vehicle_id, work_order_status, state
       )
       values ('work_order', $1, $2, $3, 'assigned', 'pending')`,
      [recorded.ride.id, driver.id, vehicle.id],
    ))).rejects.toMatchObject({ code: '23514' })
})

it('writes no entry when the Driver has no email', async () => {
  const world = await office('mbox-blank')
  const driver = await createDriver(world.dispatcher, {
    name: 'Marko Blank',
    kind: 'own',
    phone: '+385911113303',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330CC',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  let calls = 0
  const assigned = await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: 0,
  }, {
    mailer: mailer(async () => {
      calls += 1
    }),
  })
  expect(assigned.workOrders).toEqual([{ driverId: driver.id, outcome: 'no_email' }])
  expect(calls).toBe(0)
  expect(await rowsFor(recorded.ride.id)).toEqual([])
})

it('retries no longer yours from the released vehicle, not the one assigned later', async () => {
  const world = await office('mbox-retry')
  const releasedDriver = await createDriver(world.dispatcher, {
    name: 'Ana Released',
    kind: 'own',
    phone: '+385911113307',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const nextDriver = await createDriver(world.dispatcher, {
    name: 'Marko Next',
    kind: 'own',
    phone: '+385911113308',
    email: 'marko-outbox@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const releasedPlate = 'ZG9330RA'
  const laterPlate = 'ZG9330RB'
  const releasedVehicle = await createVehicle(world.dispatcher, {
    registrationPlate: releasedPlate,
    description: 'Stari kombi',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const laterVehicle = await createVehicle(world.dispatcher, {
    registrationPlate: laterPlate,
    description: 'Novi kombi',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  const logs = captureLogs()
  const failing = mailer(async () => {
    throw new Error('Work order email was not sent.')
  })
  await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: releasedDriver.id,
    vehicleId: releasedVehicle.id,
    version: 0,
  }, { mailer: failing, logger: logs.logger })
  // Reassign drops vehicle A from the Ride. The "no longer yours" row keeps it.
  await reassignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: nextDriver.id,
    vehicleId: laterVehicle.id,
    version: await transferVersion(recorded.ride.id),
  }, {
    logger: logs.logger,
    mailer: mailer(async (mail) => {
      if (mail.subject.startsWith('Više nije vaše') || mail.text.startsWith('Više nije vaše'))
        throw new Error('Work order email was not sent.')
    }),
  })

  const rows = await rowsFor(recorded.ride.id)
  const released = rows.find(row => row.work_order_status === 'no_longer_yours')
  expect(released).toMatchObject({
    state: 'pending',
    vehicle_id: releasedVehicle.id,
    driver_id: releasedDriver.id,
  })
  const entryId = released?.id
  if (entryId === undefined)
    throw new Error('missing entry')

  const sent: Array<{ text: string, subject: string }> = []
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: world.tenantId }, async () => {
      await handleMailOutboxJob({
        id: '6b1e0c3a-1111-4111-8111-111111111111',
        name: 'mail-outbox',
        tenantId: world.tenantId,
        data: { entryId },
      }, { transaction }, {
        mailer: mailer(async (mail) => {
          sent.push({ text: mail.text, subject: mail.subject })
        }),
        queue: {
          async enqueue() {
            throw new Error('a sent retry must not schedule another attempt')
          },
          async handleNext() {
            return null
          },
          async schedule() {},
          async workScheduled() {},
          async work() {},
          async close() {},
        },
        log: captureLogs().logger,
        // The row's next attempt is one minute after the clear. This clock is past that.
        now: () => new Date(Date.now() + 2 * 60 * 1000),
        openStore: outboxAttemptStore,
      })
    })
  })

  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toContain(releasedPlate)
  expect(sent[0]?.text).toContain('Stari kombi')
  expect(sent[0]?.text).not.toContain(laterPlate)
  expect(sent[0]?.text).not.toContain('Novi kombi')
  expect(JSON.stringify(sent)).not.toContain(address)
  const [row] = (await rowsFor(recorded.ride.id)).filter(item => item.id === entryId)
  expect(row).toMatchObject({ state: 'sent', vehicle_id: releasedVehicle.id })
})

it('replaces an older work order only when the later one names the same driver', async () => {
  const world = await office('mbox-same')
  const driverA = await createDriver(world.dispatcher, {
    name: 'Ana Same',
    kind: 'own',
    phone: '+385911113309',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const driverB = await createDriver(world.dispatcher, {
    name: 'Marko Same',
    kind: 'own',
    phone: '+385911113310',
    email: 'marko-same@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicleA = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330SA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const vehicleB = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330SB',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  const quiet = { mailer: mailer(async () => {}), logger: captureLogs().logger }
  await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driverA.id,
    vehicleId: vehicleA.id,
    version: 0,
  }, quiet)
  // One transaction writes B assigned and A no longer yours. They share created_at.
  await reassignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driverB.id,
    vehicleId: vehicleB.id,
    version: await transferVersion(recorded.ride.id),
  }, quiet)
  // A later transaction. Only B's earlier mail is replaced.
  await changeVehicle(world.dispatcher, {
    rideId: recorded.ride.id,
    vehicleId: vehicleA.id,
    version: await transferVersion(recorded.ride.id),
  }, quiet)

  const rows = await rowsFor(recorded.ride.id)
  const aLost = rows.find(row => row.driver_id === driverA.id && row.work_order_status === 'no_longer_yours')
  const bAssigned = rows.find(row => row.driver_id === driverB.id && row.work_order_status === 'assigned')
  const bChanged = rows.find(row => row.driver_id === driverB.id && row.work_order_status === 'changed')
  if (aLost === undefined || bAssigned === undefined || bChanged === undefined)
    throw new Error('missing entry')

  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: world.tenantId }, async () => {
      const store = outboxAttemptStore(transaction)
      expect((await store.load(aLost.id))?.superseded).toBe(false)
      expect((await store.load(bAssigned.id))?.superseded).toBe(true)
      expect((await store.load(bChanged.id))?.superseded).toBe(false)
    })
  })
})

it('replaces A no longer yours when A is assigned the Ride again', async () => {
  const world = await office('mbox-return')
  const driverA = await createDriver(world.dispatcher, {
    name: 'Ana Return',
    kind: 'own',
    phone: '+385911113311',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const driverB = await createDriver(world.dispatcher, {
    name: 'Marko Return',
    kind: 'own',
    phone: '+385911113312',
    email: 'marko-return@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicleA = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330TA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const vehicleB = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330TB',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  const quiet = { mailer: mailer(async () => {}), logger: captureLogs().logger }
  await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driverA.id,
    vehicleId: vehicleA.id,
    version: 0,
  }, quiet)
  await reassignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driverB.id,
    vehicleId: vehicleB.id,
    version: await transferVersion(recorded.ride.id),
  }, quiet)
  await reassignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driverA.id,
    vehicleId: vehicleA.id,
    version: await transferVersion(recorded.ride.id),
  }, quiet)

  const rows = await rowsFor(recorded.ride.id)
  const aLost = rows.find(row => row.driver_id === driverA.id && row.work_order_status === 'no_longer_yours')
  if (aLost === undefined)
    throw new Error('missing entry')

  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: world.tenantId }, async () => {
      const loaded = await outboxAttemptStore(transaction).load(aLost.id)
      expect(loaded?.superseded).toBe(true)
    })
  })
})

async function transferVersion(rideId: string): Promise<number> {
  const version = await ownerPool.query<{ version: number }>(
    `select t.version
     from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  return Number(version.rows[0]?.version)
}

it('hides Tenant A entries from Tenant B, and Tenant B cannot change or delete them', async () => {
  const world = await office('mbox-iso-a')
  const other = await office('mbox-iso-b')
  const driver = await createDriver(world.dispatcher, {
    name: 'Ana Isolated',
    kind: 'own',
    phone: '+385911113304',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG9330DD',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world))
  await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: 0,
  }, {
    mailer: mailer(async () => {}),
  })

  const seenByB = await withAppTenant(other.tenantId, async (client) => {
    const selected = await client.query('select id from app.mail_outbox')
    const updated = await client.query(`update app.mail_outbox set state = 'failed'`)
    // ADR-0045 grants DELETE for the 90-day job. The row policy still hides A's entries from B.
    const deleted = await client.query('delete from app.mail_outbox')
    return { rows: selected.rows, updated: updated.rowCount, deleted: deleted.rowCount }
  })
  expect(seenByB.rows).toEqual([])
  expect(seenByB.updated).toBe(0)
  expect(seenByB.deleted).toBe(0)

  await expect(withAppTenant(other.tenantId, client =>
    client.query(
      `insert into app.mail_outbox (tenant_id, kind, ride_id, driver_id, work_order_status, state)
       values ($1, 'work_order', $2, $3, 'assigned', 'pending')`,
      [world.tenantId, recorded.ride.id, driver.id],
    ))).rejects.toMatchObject({ code: '42501' })

  const [row] = await rowsFor(recorded.ride.id)
  expect(row).toMatchObject({ state: 'sent', attempt_count: 1 })
})
