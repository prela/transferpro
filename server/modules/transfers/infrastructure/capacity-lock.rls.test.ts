import type { TenantRole } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { sql } from 'drizzle-orm'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import postAssign from '../../../api/rides/[id]/assign.post'
import postCancel from '../../../api/rides/[id]/cancel.post'
import postClear from '../../../api/rides/[id]/clear.post'
import postLanding from '../../../api/rides/[id]/landing.post'
import postReassign from '../../../api/rides/[id]/reassign.post'
import postVehicle from '../../../api/rides/[id]/vehicle.post'
import patchTransfer from '../../../api/transfers/[id].patch'
import { createClient } from '../../clients'
import { createDriver } from '../../drivers'
import { createLocation } from '../../locations'
import { closeTenantRuntime, createTenant, handleAuthRequest, withTenantFromSession } from '../../tenancy'
import { createVehicle } from '../../vehicles'
import { assignUnassignedRide } from './assign'
import { createTransfer } from './transfer-access'

/**
 * ADR-0034: every capacity write of a Tenant takes one Tenant lock, so two
 * of them run one after the other. Each concurrency case holds one
 * assignment open inside `withTenantFromSession` and sends the second
 * command through its HTTP route while the first is uncommitted. The order
 * is fixed, not raced: the route either answers while the first is still
 * open, or it is seen blocked by the first transaction's backend, and only
 * then does the first commit. No lock call is asserted.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

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
const password = 'capacity-lock-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const hour = 60 * 60 * 1000

const app = createApp()
app.use('/api/rides', (event) => {
  const [id, action] = (event.path.split('?')[0] ?? '').split('/').filter(Boolean)
  event.context.params = { id: id ?? '' }
  if (action === 'assign')
    return postAssign(event)
  if (action === 'vehicle')
    return postVehicle(event)
  if (action === 'reassign')
    return postReassign(event)
  if (action === 'clear')
    return postClear(event)
  if (action === 'cancel')
    return postCancel(event)
  if (action === 'landing')
    return postLanding(event)
  return new Response('Not Found', { status: 404 })
})
app.use('/api/transfers', (event) => {
  // The mount strips `/api/transfers`, so a correction is `/<id>`.
  event.context.params = { id: (event.path.split('?')[0] ?? '').split('/').filter(Boolean).at(-1) ?? '' }
  return patchTransfer(event)
})
const handle = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  const tenants = `select id from auth.organization where slug like 'hcap-%'`
  try {
    await owner.query('begin')
    for (const table of ['mail_outbox', 'ride_alert', 'rides', 'roster', 'transfers', 'drivers', 'vehicles', 'locations', 'clients', 'tenant_settings'])
      await owner.query(`delete from app.${table} where tenant_id::text in (${tenants})`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hcap-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hcap-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hcap-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hcap-%'`)
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

async function addMember(tenantId: string, email: string, role: TenantRole): Promise<void> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Dino Dispatcher', $2, true, now(), now())`,
    [userId, email],
  )
  await authPool.query(
    `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), userId, await hashPassword(password)],
  )
  await authPool.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), tenantId, userId, role],
  )
}

/** Two office members of one Tenant: the admin holds, the dispatcher sends. */
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
  await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'dispatcher')
  const admin = await signIn(`${slug}-admin@example.test`)
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  let drivers = 0
  let vehicles = 0
  return {
    tenantId: created.tenantId,
    admin,
    dispatcher,
    booking(pickupAt: Date) {
      return {
        clientId: client.id,
        pickupAt: pickupAt.toISOString(),
        startLocationId: start.id,
        endLocationId: end.id,
        passengerCount: 1,
        guestName: 'Ana Anić',
        price: 10,
        payment: 'cash' as const,
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      }
    },
    async transfer(pickupAt: Date) {
      // The key is added here, not on booking(), because a correction spreads booking() and refuses the key.
      return createTransfer(dispatcher, { externalId: crypto.randomUUID(), ...this.booking(pickupAt) })
    },
    // An email, so a passing assign stages a work order in the mail outbox.
    async driver() {
      drivers += 1
      return createDriver(dispatcher, {
        name: 'Marko Vozač',
        kind: 'own',
        phone: `+38591111${String(drivers).padStart(4, '0')}`,
        email: `${slug}-driver-${drivers}@example.test`,
        drivingLicenceExpiresOn: '2030-01-01',
        transportLicenceExpiresOn: '2030-06-01',
      })
    },
    async vehicle() {
      vehicles += 1
      return createVehicle(dispatcher, {
        registrationPlate: `ZG${String(vehicles).padStart(4, '0')}CL`,
        kind: 'fixed',
        registrationExpiresOn: '2030-01-01',
        technicalInspectionExpiresOn: '2030-01-01',
        insuranceExpiresOn: '2030-01-01',
      })
    },
  }
}

async function call(method: string, path: string, session: Headers, body: unknown): Promise<Response> {
  const headers = new Headers(session)
  headers.set('content-type', 'application/json')
  return handle(new Request(`http://localhost${path}`, { method, headers, body: JSON.stringify(body) }))
}

async function versionForRide(rideId: string): Promise<number> {
  const result = await ownerPool.query<{ version: number }>(
    `select t.version from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  return Number(result.rows[0]?.version)
}

async function assign(session: Headers, rideId: string, driverId: string, vehicleId: string): Promise<Response> {
  return call('POST', `/api/rides/${rideId}/assign`, session, { driverId, vehicleId, version: await versionForRide(rideId) })
}

const backendRows = z.object({ rows: z.array(z.object({ pid: z.number().int() })) })

async function backendPid(transaction: TenantTransaction): Promise<number> {
  const pid = backendRows.parse(await transaction.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid
  if (pid === undefined)
    throw new Error('no backend pid')
  return pid
}

/**
 * `answered` when the route finished first. `waited` when another backend
 * is blocked by `holder` before the route has answered.
 */
async function answeredOrWaited(holder: number, sent: Promise<Response>): Promise<'answered' | 'waited'> {
  const route = { answered: false }
  void sent.then(() => {
    route.answered = true
  }, () => {
    route.answered = true
  })
  const watcher = await appPool.connect()
  try {
    while (!route.answered) {
      const blocked = await watcher.query(
        'select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
        [holder],
      )
      if ((blocked.rowCount ?? 0) > 0 && !route.answered)
        return 'waited'
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return 'answered'
  }
  finally {
    watcher.release()
  }
}

/**
 * Assign `held` inside `withTenantFromSession` and keep that transaction open
 * while `second` is sent. The held assignment commits once the order is known.
 */
async function whileAssignmentHeld(
  session: Headers,
  held: { rideId: string, driverId: string, vehicleId: string },
  second: () => Promise<Response>,
): Promise<{ order: 'answered' | 'waited', response: Response }> {
  const version = await versionForRide(held.rideId)
  let sent: Promise<Response> | undefined
  const order = await withTenantFromSession(session, async ({ actor, transaction }) => {
    await assignUnassignedRide(transaction, actor.userId, { ...held, version })
    sent = second()
    return answeredOrWaited(await backendPid(transaction), sent)
  })
  if (!sent)
    throw new Error('second command was not sent')
  return { order, response: await sent }
}

async function rideRow(rideId: string) {
  return (await ownerPool.query(
    'select state, driver_id, vehicle_id, must_accept from app.rides where id = $1',
    [rideId],
  )).rows[0]
}

async function transferRow(transferId: string) {
  return (await ownerPool.query('select * from app.transfers where id = $1', [transferId])).rows[0]
}

async function auditRows(tenantId: string) {
  return (await ownerPool.query(
    'select id, action::text as action, data from app.audit_entry where tenant_id = $1 order by occurred_at, id',
    [tenantId],
  )).rows
}

async function outboxRows(tenantId: string) {
  return (await ownerPool.query(
    'select id, kind, ride_id, driver_id, vehicle_id, work_order_status from app.mail_outbox where tenant_id = $1 order by created_at, id',
    [tenantId],
  )).rows
}

async function snapshot(tenantId: string, ride: { id: string, transferId: string }) {
  return {
    ride: await rideRow(ride.id),
    transfer: await transferRow(ride.transferId),
    audit: await auditRows(tenantId),
    outbox: await outboxRows(tenantId),
  }
}

/**
 * The refused Ride, its Transfer and version, and the mail outbox are as
 * they were before the held assignment. The only new audit entry is that
 * held assignment.
 */
async function expectOnlyHeldAssignment(
  tenantId: string,
  before: Awaited<ReturnType<typeof snapshot>>,
  refused: { id: string, transferId: string },
  heldRideId: string,
): Promise<void> {
  const after = await snapshot(tenantId, refused)
  expect(after.ride).toEqual(before.ride)
  expect(after.transfer).toEqual(before.transfer)
  expect(after.outbox).toEqual(before.outbox)
  const added = after.audit.slice(before.audit.length)
  expect(after.audit.slice(0, before.audit.length)).toEqual(before.audit)
  expect(added.map(row => [row.action, row.data.rideId])).toEqual([['ride.assigned', heldRideId]])
}

it('a second assignment of the same Driver to a clashing Ride waits, then is fully booked', async () => {
  const world = await office('hcap-driver')
  const driver = await world.driver()
  const firstVehicle = await world.vehicle()
  const secondVehicle = await world.vehicle()
  const pickup = new Date(Date.now() + 5 * hour)
  const first = await world.transfer(pickup)
  const second = await world.transfer(new Date(pickup.getTime() + 30 * 60 * 1000))
  const before = await snapshot(world.tenantId, second.ride)

  const { order, response } = await whileAssignmentHeld(
    world.admin,
    { rideId: first.ride.id, driverId: driver.id, vehicleId: firstVehicle.id },
    () => call('POST', `/api/rides/${second.ride.id}/assign`, world.dispatcher, {
      driverId: driver.id,
      vehicleId: secondVehicle.id,
      version: Number(before.transfer.version),
    }),
  )

  expect(order).toBe('waited')
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('fully_booked')
  expect(await rideRow(first.ride.id)).toMatchObject({ state: 'assigned', driver_id: driver.id })
  expect(await rideRow(second.ride.id)).toEqual({ state: 'unassigned', driver_id: null, vehicle_id: null, must_accept: null })
  await expectOnlyHeldAssignment(world.tenantId, before, second.ride, first.ride.id)
})

it('a second assignment of the same Vehicle with another Driver waits, then is fully booked', async () => {
  const world = await office('hcap-vehicle')
  const firstDriver = await world.driver()
  const secondDriver = await world.driver()
  const vehicle = await world.vehicle()
  const pickup = new Date(Date.now() + 5 * hour)
  const first = await world.transfer(pickup)
  const second = await world.transfer(pickup)
  const before = await snapshot(world.tenantId, second.ride)

  const { order, response } = await whileAssignmentHeld(
    world.admin,
    { rideId: first.ride.id, driverId: firstDriver.id, vehicleId: vehicle.id },
    () => call('POST', `/api/rides/${second.ride.id}/assign`, world.dispatcher, {
      driverId: secondDriver.id,
      vehicleId: vehicle.id,
      version: Number(before.transfer.version),
    }),
  )

  expect(order).toBe('waited')
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('fully_booked')
  expect(await rideRow(first.ride.id)).toMatchObject({ state: 'assigned', vehicle_id: vehicle.id })
  expect(await rideRow(second.ride.id)).toEqual({ state: 'unassigned', driver_id: null, vehicle_id: null, must_accept: null })
  await expectOnlyHeldAssignment(world.tenantId, before, second.ride, first.ride.id)
})

it('a confirmed overlap waits while the last free pair is taken, and is fully booked', async () => {
  const world = await office('hcap-full')
  const driver = await world.driver()
  const vehicle = await world.vehicle()
  const pickup = new Date(Date.now() + 5 * hour)
  const first = await world.transfer(pickup)
  const second = await world.transfer(new Date(pickup.getTime() + 30 * 60 * 1000))
  const before = await snapshot(world.tenantId, second.ride)

  const { order, response } = await whileAssignmentHeld(
    world.admin,
    { rideId: first.ride.id, driverId: driver.id, vehicleId: vehicle.id },
    () => call('POST', `/api/rides/${second.ride.id}/assign`, world.dispatcher, {
      driverId: driver.id,
      vehicleId: vehicle.id,
      version: Number(before.transfer.version),
      confirm: true,
    }),
  )

  expect(order).toBe('waited')
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('fully_booked')
  expect(await rideRow(first.ride.id)).toMatchObject({ state: 'assigned', driver_id: driver.id, vehicle_id: vehicle.id })
  expect(await rideRow(second.ride.id)).toEqual({ state: 'unassigned', driver_id: null, vehicle_id: null, must_accept: null })
  await expectOnlyHeldAssignment(world.tenantId, before, second.ride, first.ride.id)
})

it('a correction that moves an assigned Ride onto a held assignment of its Driver waits and is refused', async () => {
  const world = await office('hcap-correct')
  const driver = await world.driver()
  const heldVehicle = await world.vehicle()
  const movedVehicle = await world.vehicle()
  const pickup = new Date(Date.now() + 5 * hour)
  const held = await world.transfer(pickup)
  const moved = await world.transfer(new Date(pickup.getTime() + 4 * hour))
  expect((await assign(world.dispatcher, moved.ride.id, driver.id, movedVehicle.id)).status).toBe(200)
  const before = await snapshot(world.tenantId, moved.ride)

  const { order, response } = await whileAssignmentHeld(
    world.admin,
    { rideId: held.ride.id, driverId: driver.id, vehicleId: heldVehicle.id },
    () => call('PATCH', `/api/transfers/${moved.transfer.id}`, world.dispatcher, {
      ...world.booking(new Date(pickup.getTime() + 30 * 60 * 1000)),
      version: Number(before.transfer.version),
    }),
  )

  expect(order).toBe('waited')
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('ride_overlap')
  expect(await rideRow(held.ride.id)).toMatchObject({ state: 'assigned', driver_id: driver.id })
  await expectOnlyHeldAssignment(world.tenantId, before, moved.ride, held.ride.id)
})

it('a capacity write in another Tenant completes while one is held open', async () => {
  const held = await office('hcap-held')
  const other = await office('hcap-other')
  const heldDriver = await held.driver()
  const heldVehicle = await held.vehicle()
  const otherDriver = await other.driver()
  const otherVehicle = await other.vehicle()
  const pickup = new Date(Date.now() + 5 * hour)
  const heldRide = await held.transfer(pickup)
  const otherRide = await other.transfer(pickup)
  const otherVersion = await versionForRide(otherRide.ride.id)

  const { order, response } = await whileAssignmentHeld(
    held.admin,
    { rideId: heldRide.ride.id, driverId: heldDriver.id, vehicleId: heldVehicle.id },
    () => call('POST', `/api/rides/${otherRide.ride.id}/assign`, other.dispatcher, {
      driverId: otherDriver.id,
      vehicleId: otherVehicle.id,
      version: otherVersion,
    }),
  )

  expect(order).toBe('answered')
  expect(response.status).toBe(200)
  expect(await rideRow(otherRide.ride.id)).toMatchObject({ state: 'assigned', driver_id: otherDriver.id })
  expect(await rideRow(heldRide.ride.id)).toMatchObject({ state: 'assigned', driver_id: heldDriver.id })
})

it('a clear, a cancel, and a landing time do not wait on a held capacity write of the same Tenant', async () => {
  const world = await office('hcap-free')
  const driver = await world.driver()
  const vehicle = await world.vehicle()
  const otherDriver = await world.driver()
  const otherVehicle = await world.vehicle()
  const pickup = new Date(Date.now() + 5 * hour)
  const held = await world.transfer(pickup)
  const cleared = await world.transfer(new Date(pickup.getTime() + 8 * hour))
  const cancelled = await world.transfer(new Date(pickup.getTime() + 10 * hour))
  const landed = await world.transfer(new Date(pickup.getTime() + 12 * hour))
  expect((await assign(world.dispatcher, cleared.ride.id, otherDriver.id, otherVehicle.id)).status).toBe(200)
  const clearVersion = await versionForRide(cleared.ride.id)
  const commands: Array<[string, () => Promise<Response>]> = [
    ['clear', () => call('POST', `/api/rides/${cleared.ride.id}/clear`, world.dispatcher, { version: clearVersion })],
    ['cancel', () => call('POST', `/api/rides/${cancelled.ride.id}/cancel`, world.dispatcher, {})],
    ['landing', () => call('POST', `/api/rides/${landed.ride.id}/landing`, world.dispatcher, { landingAt: new Date(Date.now() - hour).toISOString() })],
  ]

  const { order, response } = await whileAssignmentHeld(
    world.admin,
    { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id },
    async () => {
      const answers = []
      for (const [name, send] of commands)
        answers.push(`${name} ${(await send()).status}`)
      return new Response(answers.join(', '))
    },
  )

  expect(order).toBe('answered')
  expect(await response.text()).toBe('clear 200, cancel 200, landing 200')
  expect(await rideRow(cleared.ride.id)).toMatchObject({ state: 'unassigned' })
  expect(await rideRow(cancelled.ride.id)).toMatchObject({ state: 'cancelled' })
})

it('a ride_overlap through the route leaves the Ride, the Transfer, the version, the audit log, and the mail outbox unchanged', async () => {
  const world = await office('hcap-refused')
  const driver = await world.driver()
  const vehicle = await world.vehicle()
  const otherVehicle = await world.vehicle()
  const otherDriver = await world.driver()
  const pickup = new Date(Date.now() + 5 * hour)
  const taken = await world.transfer(pickup)
  const refusedRide = await world.transfer(new Date(pickup.getTime() + 30 * 60 * 1000))
  const reassigned = await world.transfer(new Date(pickup.getTime() + 30 * 60 * 1000))
  expect((await assign(world.dispatcher, taken.ride.id, driver.id, vehicle.id)).status).toBe(200)
  expect((await assign(world.dispatcher, reassigned.ride.id, otherDriver.id, otherVehicle.id)).status).toBe(200)

  const beforeAssign = await snapshot(world.tenantId, refusedRide.ride)
  const assigned = await call('POST', `/api/rides/${refusedRide.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: otherVehicle.id,
    version: Number(beforeAssign.transfer.version),
  })
  expect(assigned.status).toBe(409)
  expect(await assigned.text()).toContain('fully_booked')
  expect(await snapshot(world.tenantId, refusedRide.ride)).toEqual(beforeAssign)

  const beforeChange = await snapshot(world.tenantId, reassigned.ride)
  const changed = await call('POST', `/api/rides/${reassigned.ride.id}/vehicle`, world.dispatcher, {
    vehicleId: vehicle.id,
    version: Number(beforeChange.transfer.version),
  })
  expect(changed.status).toBe(409)
  expect(await changed.text()).toContain('ride_overlap')
  const moved = await call('POST', `/api/rides/${reassigned.ride.id}/reassign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: otherVehicle.id,
    version: Number(beforeChange.transfer.version),
  })
  expect(moved.status).toBe(409)
  expect(await moved.text()).toContain('ride_overlap')
  expect(await snapshot(world.tenantId, reassigned.ride)).toEqual(beforeChange)
})
