import type { TenantRole } from '../../../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, getMethod, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import postAssign from '../../../api/rides/[id]/assign.post'
import postHandOff from '../../../api/rides/[id]/hand-off.post'
import postPartner from '../../../api/rides/[id]/partner.post'
import postReassign from '../../../api/rides/[id]/reassign.post'
import postVehicle from '../../../api/rides/[id]/vehicle.post'
import getTransfers from '../../../api/transfers.get'
import postTransfers from '../../../api/transfers.post'
import patchTransfer from '../../../api/transfers/[id].patch'
import postWindow from '../../../api/unavailability.post'
import { createClient } from '../../clients'
import { createDriver } from '../../drivers'
import { createLocation } from '../../locations'
import { createPartner } from '../../partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../../tenancy'
import { createVehicle } from '../../vehicles'

/**
 * Fully booked through the routes (ADR-0034, issue #413). A window with no
 * free Driver and Vehicle and no free Partner is 409 `fully_booked` on
 * assign, a Vehicle change, a reassignment, a handoff, and a Partner change.
 * `confirm: true` does not pass it, and nothing is written. Creating or
 * correcting a Transfer still saves and returns the warning. The board
 * derives Popunjeno on an unassigned Ride.
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
required('DATABASE_URL')
const authUrl = required('BETTER_AUTH_URL')
const password = 'fully-booked-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const pickup = '2026-11-12T12:00:00.000Z'
const later = '2026-11-12T16:00:00.000Z'
const covered = { startsAt: '2026-11-12T00:00:00.000Z', endsAt: '2026-11-13T00:00:00.000Z' }

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
  if (action === 'hand-off')
    return postHandOff(event)
  if (action === 'partner')
    return postPartner(event)
  return new Response('Not Found', { status: 404 })
})
app.use('/api/transfers', (event) => {
  const parts = (event.path.split('?')[0] ?? '').split('/').filter(Boolean)
  if (parts.length === 0)
    return getMethod(event) === 'GET' ? getTransfers(event) : postTransfers(event)
  event.context.params = { id: parts.at(-1) ?? '' }
  return patchTransfer(event)
})
app.use('/api/unavailability', event => postWindow(event))
const handle = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  const tenants = `select id from auth.organization where slug like 'fbk-%'`
  try {
    await owner.query('begin')
    for (const table of ['mail_outbox', 'rides', 'unavailability_windows', 'transfers', 'partners', 'drivers', 'vehicles', 'locations', 'clients', 'tenant_settings'])
      await owner.query(`delete from app.${table} where tenant_id::text in (${tenants})`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'fbk-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'fbk-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'fbk-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'fbk-%'`)
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
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  let drivers = 0
  let vehicles = 0
  return {
    tenantId: created.tenantId,
    dispatcher,
    booking(pickupAt: string, guestName = 'Ana Anić') {
      return {
        clientId: client.id,
        pickupAt,
        startLocationId: start.id,
        endLocationId: end.id,
        passengerCount: 1,
        guestName,
        price: 10,
        payment: 'cash' as const,
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
        tabla: '',
      }
    },
    async driver() {
      drivers += 1
      return createDriver(dispatcher, {
        name: 'Marko Vozač',
        kind: 'own',
        phone: `+38591333${String(drivers).padStart(4, '0')}`,
        drivingLicenceExpiresOn: '2030-01-01',
        transportLicenceExpiresOn: '2030-06-01',
      })
    },
    async vehicle() {
      vehicles += 1
      return createVehicle(dispatcher, {
        registrationPlate: `ZG${String(vehicles).padStart(4, '0')}FB`,
        kind: 'fixed',
        seatCount: 4,
        registrationExpiresOn: '2030-01-01',
        technicalInspectionExpiresOn: '2030-01-01',
        insuranceExpiresOn: '2030-01-01',
      })
    },
  }
}

async function call(method: string, path: string, session: Headers, body?: unknown): Promise<Response> {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}

async function versionOf(rideId: string): Promise<number> {
  const result = await ownerPool.query<{ version: string }>(
    `select t.version::text as version from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  return Number(result.rows[0]?.version)
}

async function counts(tenantId: string) {
  const audit = await ownerPool.query<{ count: string }>(`select count(*) from app.audit_entry where tenant_id = $1`, [tenantId])
  const mail = await ownerPool.query<{ count: string }>(`select count(*) from app.mail_outbox where tenant_id = $1`, [tenantId])
  return { audit: Number(audit.rows[0]?.count), mail: Number(mail.rows[0]?.count) }
}

async function rideRow(rideId: string) {
  return (await ownerPool.query(
    `select state, driver_id, vehicle_id, partner_id from app.rides where id = $1`,
    [rideId],
  )).rows[0]
}

async function transferRow(rideId: string) {
  return (await ownerPool.query(
    `select t.guest_name, t.pickup_at, t.version::text as version
     from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )).rows[0]
}

async function boardFullyBooked(session: Headers, rideId: string): Promise<boolean> {
  const response = await call('GET', '/api/transfers?date=2026-11-12', session)
  expect(response.status).toBe(200)
  const body = await response.json() as { rides: Array<{ rideId: string, warnings: { fullyBooked?: boolean } }> }
  return body.rides.find(ride => ride.rideId === rideId)?.warnings.fullyBooked === true
}

it('a create, a duplicate, and a return save with the warning, and a correction is never refused as fully booked', async () => {
  const world = await office('fbk-save')
  const created = await call('POST', '/api/transfers', world.dispatcher, {
    externalId: crypto.randomUUID(),
    ...world.booking(pickup),
  })
  expect(created.status).toBe(200)
  const saved = await created.json() as { fullyBooked: boolean, transfer: { id: string }, ride: { id: string } }
  expect(saved.fullyBooked).toBe(true)
  expect(await boardFullyBooked(world.dispatcher, saved.ride.id)).toBe(true)

  const duplicate = await call('POST', '/api/transfers', world.dispatcher, {
    externalId: crypto.randomUUID(),
    ...world.booking(pickup, 'Iva Ivić'),
  })
  expect(duplicate.status).toBe(200)
  expect((await duplicate.json() as { fullyBooked: boolean }).fullyBooked).toBe(true)

  const returned = await call('POST', '/api/transfers', world.dispatcher, {
    externalId: crypto.randomUUID(),
    ...world.booking(later, 'Tea Tić'),
  })
  expect(returned.status).toBe(200)
  expect((await returned.json() as { fullyBooked: boolean }).fullyBooked).toBe(true)

  const corrected = await call('PATCH', `/api/transfers/${saved.transfer.id}`, world.dispatcher, {
    ...world.booking(pickup, 'Mia Milić'),
    version: await versionOf(saved.ride.id),
  })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({ fullyBooked: true, transfer: { guestName: 'Mia Milić' } })

  const driver = await world.driver()
  const vehicle = await world.vehicle()
  const otherVehicle = await world.vehicle()
  const held = await call('POST', '/api/transfers', world.dispatcher, {
    externalId: crypto.randomUUID(),
    ...world.booking(pickup, 'Held Held'),
  })
  const heldBody = await held.json() as { ride: { id: string }, fullyBooked: boolean }
  expect(heldBody.fullyBooked).toBe(false)
  expect((await call('POST', `/api/rides/${heldBody.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: 0,
  })).status).toBe(200)

  const moving = await call('POST', '/api/transfers', world.dispatcher, {
    externalId: crypto.randomUUID(),
    ...world.booking(later, 'Move Move'),
  })
  const movingBody = await moving.json() as { transfer: { id: string }, ride: { id: string } }
  expect((await call('POST', `/api/rides/${movingBody.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: otherVehicle.id,
    version: 0,
  })).status).toBe(200)
  const moved = await call('PATCH', `/api/transfers/${movingBody.transfer.id}`, world.dispatcher, {
    ...world.booking(pickup, 'Move Move'),
    version: await versionOf(movingBody.ride.id),
    confirm: true,
  })
  // The only Driver is taken. Confirming passes the overlap. Fully booked does not refuse the correction.
  expect(moved.status).toBe(200)
  expect(await moved.json()).toMatchObject({ fullyBooked: true, transfer: { pickupAt: pickup } })
})

it('assign, a vehicle change, a reassignment, a handoff, and a partner change are fully booked, and confirm does not pass', async () => {
  const world = await office('fbk-block')
  const firstDriver = await world.driver()
  const secondDriver = await world.driver()
  const firstVehicle = await world.vehicle()
  const secondVehicle = await world.vehicle()
  const open = await call('POST', '/api/transfers', world.dispatcher, { externalId: crypto.randomUUID(), ...world.booking(pickup, 'Open Open') })
  const taken = await call('POST', '/api/transfers', world.dispatcher, { externalId: crypto.randomUUID(), ...world.booking(pickup, 'Taken One') })
  const other = await call('POST', '/api/transfers', world.dispatcher, { externalId: crypto.randomUUID(), ...world.booking(pickup, 'Taken Two') })
  const openBody = await open.json() as { ride: { id: string } }
  const takenBody = await taken.json() as { ride: { id: string } }
  const otherBody = await other.json() as { ride: { id: string } }
  expect((await call('POST', `/api/rides/${takenBody.ride.id}/assign`, world.dispatcher, {
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
    version: 0,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${otherBody.ride.id}/assign`, world.dispatcher, {
    driverId: secondDriver.id,
    vehicleId: secondVehicle.id,
    version: 0,
  })).status).toBe(200)
  for (const owner of [
    { driverId: firstDriver.id },
    { driverId: secondDriver.id },
    { vehicleId: firstVehicle.id },
    { vehicleId: secondVehicle.id },
  ]) {
    expect((await call('POST', '/api/unavailability', world.dispatcher, { ...owner, ...covered })).status).toBe(200)
  }

  const beforeAssign = { ride: await rideRow(openBody.ride.id), transfer: await transferRow(openBody.ride.id), version: await versionOf(openBody.ride.id), ...await counts(world.tenantId) }
  const refusedAssign = await call('POST', `/api/rides/${openBody.ride.id}/assign`, world.dispatcher, {
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
    version: beforeAssign.version,
    confirm: true,
  })
  expect(refusedAssign.status).toBe(409)
  expect(await refusedAssign.json()).toMatchObject({ data: { code: 'fully_booked' } })
  expect(await rideRow(openBody.ride.id)).toEqual(beforeAssign.ride)
  expect(await transferRow(openBody.ride.id)).toEqual(beforeAssign.transfer)
  expect(await versionOf(openBody.ride.id)).toBe(beforeAssign.version)
  expect(await counts(world.tenantId)).toEqual({ audit: beforeAssign.audit, mail: beforeAssign.mail })

  const beforeChange = { ride: await rideRow(otherBody.ride.id), transfer: await transferRow(otherBody.ride.id), version: await versionOf(otherBody.ride.id), ...await counts(world.tenantId) }
  const refusedChange = await call('POST', `/api/rides/${otherBody.ride.id}/vehicle`, world.dispatcher, {
    vehicleId: firstVehicle.id,
    version: beforeChange.version,
    confirm: true,
  })
  expect(await refusedChange.json()).toMatchObject({ statusCode: 409, data: { code: 'fully_booked' } })
  const refusedReassign = await call('POST', `/api/rides/${otherBody.ride.id}/reassign`, world.dispatcher, {
    driverId: firstDriver.id,
    vehicleId: secondVehicle.id,
    version: beforeChange.version,
    confirm: true,
  })
  expect(await refusedReassign.json()).toMatchObject({ statusCode: 409, data: { code: 'fully_booked' } })
  expect(await rideRow(otherBody.ride.id)).toEqual(beforeChange.ride)
  expect(await transferRow(otherBody.ride.id)).toEqual(beforeChange.transfer)
  expect(await versionOf(otherBody.ride.id)).toBe(beforeChange.version)
  expect(await counts(world.tenantId)).toEqual({ audit: beforeChange.audit, mail: beforeChange.mail })

  const away = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const otherPartner = await createPartner(world.dispatcher, { name: 'Drugi Prijevoz' })
  const handed = await call('POST', '/api/transfers', world.dispatcher, { externalId: crypto.randomUUID(), ...world.booking(later, 'Hand Hand') })
  const handedBody = await handed.json() as { ride: { id: string } }
  expect((await call('POST', `/api/rides/${handedBody.ride.id}/hand-off`, world.dispatcher, {
    partnerId: away.id,
    version: 0,
  })).status).toBe(200)
  expect((await call('POST', '/api/unavailability', world.dispatcher, { partnerId: away.id, ...covered })).status).toBe(200)
  expect((await call('POST', '/api/unavailability', world.dispatcher, { partnerId: otherPartner.id, ...covered })).status).toBe(200)

  const fresh = await call('POST', '/api/transfers', world.dispatcher, { externalId: crypto.randomUUID(), ...world.booking(pickup, 'Fresh Fresh') })
  const freshBody = await fresh.json() as { ride: { id: string } }
  const beforeHandoff = { ride: await rideRow(freshBody.ride.id), transfer: await transferRow(freshBody.ride.id), version: await versionOf(freshBody.ride.id), ...await counts(world.tenantId) }
  const refusedHandoff = await call('POST', `/api/rides/${freshBody.ride.id}/hand-off`, world.dispatcher, {
    partnerId: otherPartner.id,
    version: beforeHandoff.version,
    confirm: true,
  })
  expect(await refusedHandoff.json()).toMatchObject({ statusCode: 409, data: { code: 'fully_booked' } })
  expect(await rideRow(freshBody.ride.id)).toEqual(beforeHandoff.ride)
  expect(await transferRow(freshBody.ride.id)).toEqual(beforeHandoff.transfer)
  expect(await versionOf(freshBody.ride.id)).toBe(beforeHandoff.version)
  expect(await counts(world.tenantId)).toEqual({ audit: beforeHandoff.audit, mail: beforeHandoff.mail })

  const beforePartner = { ride: await rideRow(handedBody.ride.id), transfer: await transferRow(handedBody.ride.id), version: await versionOf(handedBody.ride.id), ...await counts(world.tenantId) }
  const refusedPartner = await call('POST', `/api/rides/${handedBody.ride.id}/partner`, world.dispatcher, {
    partnerId: otherPartner.id,
    version: beforePartner.version,
    confirm: true,
  })
  expect(await refusedPartner.json()).toMatchObject({ statusCode: 409, data: { code: 'fully_booked' } })
  expect(await rideRow(handedBody.ride.id)).toEqual(beforePartner.ride)
  expect(await transferRow(handedBody.ride.id)).toEqual(beforePartner.transfer)
  expect(await versionOf(handedBody.ride.id)).toBe(beforePartner.version)
  expect(await counts(world.tenantId)).toEqual({ audit: beforePartner.audit, mail: beforePartner.mail })
})

it('the board shows Popunjeno while nothing is free, and drops it when a pair or a Partner is', async () => {
  const world = await office('fbk-board')
  const created = await call('POST', '/api/transfers', world.dispatcher, {
    externalId: crypto.randomUUID(),
    ...world.booking(pickup),
  })
  const saved = await created.json() as { ride: { id: string } }
  expect(await boardFullyBooked(world.dispatcher, saved.ride.id)).toBe(true)

  const driver = await world.driver()
  expect(await boardFullyBooked(world.dispatcher, saved.ride.id)).toBe(true)
  const vehicle = await world.vehicle()
  expect(await boardFullyBooked(world.dispatcher, saved.ride.id)).toBe(false)

  expect((await call('POST', '/api/unavailability', world.dispatcher, { driverId: driver.id, ...covered })).status).toBe(200)
  expect((await call('POST', '/api/unavailability', world.dispatcher, { vehicleId: vehicle.id, ...covered })).status).toBe(200)
  expect(await boardFullyBooked(world.dispatcher, saved.ride.id)).toBe(true)

  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  expect(await boardFullyBooked(world.dispatcher, saved.ride.id)).toBe(false)
  expect((await call('POST', '/api/unavailability', world.dispatcher, { partnerId: partner.id, ...covered })).status).toBe(200)
  expect(await boardFullyBooked(world.dispatcher, saved.ride.id)).toBe(true)
})
