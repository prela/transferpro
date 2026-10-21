import type { TenantRole } from '../../../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { instantFromWallClock } from '../../../../shared'
import getPartnerWindows from '../../../api/partners/[id]/unavailability.get'
import postHandOff from '../../../api/rides/[id]/hand-off.post'
import postPartner from '../../../api/rides/[id]/partner.post'
import getTransfers from '../../../api/transfers.get'
import postWindow from '../../../api/unavailability.post'
import postRemove from '../../../api/unavailability/[id]/remove.post'
import { createClient } from '../../clients'
import { createLocation } from '../../locations'
import { createPartner } from '../../partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../../tenancy'
import { createTransfer } from './transfer-access'

/**
 * Partner unavailability through the routes (ADR-0034, issue #411).
 * A 409 `ride_unavailable` on a handoff and on a change of Partner writes
 * nothing. `confirm: true` passes. Another Tenant cannot read or write a
 * Partner window, and a window cannot name another Tenant's Partner. The
 * board warning follows the window.
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
const password = 'partner-window-password'
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const zone = 'Europe/Zagreb'

const app = createApp()
function relativePath(eventPath: string, marker: string): string {
  const pathOnly = (eventPath.split('?')[0] ?? '/').replace(/\/$/, '')
  return pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly.replace(/^\//, '')
}

app.use('/api/rides', (event) => {
  const [id, action] = relativePath(event.path, '/api/rides/').split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'hand-off')
    return postHandOff(event)
  if (action === 'partner')
    return postPartner(event)
  return new Response('Not Found', { status: 404 })
})
app.use('/api/transfers', event => getTransfers(event))
app.use('/api/unavailability', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '').replace(/\/$/, '')
  if (pathOnly === '/api/unavailability' || pathOnly === '')
    return postWindow(event)
  const [id, action] = relativePath(event.path, '/api/unavailability/').split('/')
  event.context.params = { id: id ?? '' }
  return action === 'remove' ? postRemove(event) : new Response('Not Found', { status: 404 })
})
app.use('/api/partners', (event) => {
  const [id, action] = relativePath(event.path, '/api/partners/').split('/')
  event.context.params = { id: id ?? '' }
  if (action !== 'unavailability')
    return new Response('Not Found', { status: 404 })
  return getPartnerWindows(event)
})
const handle = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  const tenants = `select id from auth.organization where slug like 'puw-%'`
  try {
    await owner.query('begin')
    for (const table of ['mail_outbox', 'rides', 'unavailability_windows', 'transfers', 'partners', 'locations', 'clients', 'tenant_settings'])
      await owner.query(`delete from app.${table} where tenant_id::text in (${tenants})`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'puw-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'puw-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'puw-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'puw-%'`)
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

function at(wall: string): Date {
  return instantFromWallClock(wall, zone)
}

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
     values ($1, 'Dino Member', $2, true, now(), now())`,
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
  await addMember(created.tenantId, `${slug}-driver@example.test`, 'driver')
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const driverSession = await signIn(`${slug}-driver@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  return {
    tenantId: created.tenantId,
    dispatcher,
    driverSession,
    async transfer(guestName: string) {
      return createTransfer(dispatcher, {
        externalId: crypto.randomUUID(),
        clientId: client.id,
        pickupAt: at('2026-11-10T12:00').toISOString(),
        startLocationId: start.id,
        endLocationId: end.id,
        passengerCount: 1,
        guestName,
        price: 10,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      })
    },
  }
}

async function call(method: string, path: string, session: Headers, body?: unknown): Promise<Response> {
  const headers = new Headers(session)
  headers.set('content-type', 'application/json')
  return handle(new Request(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
}

async function versionOf(rideId: string) {
  const result = await ownerPool.query<{ version: string }>(
    `select t.version::text from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  return Number(result.rows[0]?.version)
}

async function rideRow(rideId: string) {
  const result = await ownerPool.query(
    `select state, partner_id, driver_id, vehicle_id from app.rides where id = $1`,
    [rideId],
  )
  return result.rows[0]
}

async function counts(tenantId: string) {
  const audit = await ownerPool.query<{ count: string }>(`select count(*) from app.audit_entry where tenant_id = $1`, [tenantId])
  const mail = await ownerPool.query<{ count: string }>(`select count(*) from app.mail_outbox where tenant_id = $1`, [tenantId])
  return { audit: Number(audit.rows[0]?.count), mail: Number(mail.rows[0]?.count) }
}

async function handOff(session: Headers, rideId: string, partnerId: string, confirm = false) {
  return call('POST', `/api/rides/${rideId}/hand-off`, session, {
    partnerId,
    version: await versionOf(rideId),
    ...(confirm ? { confirm: true } : {}),
  })
}

const windowTimes = {
  startsAt: at('2026-11-10T00:00').toISOString(),
  endsAt: at('2026-11-11T00:00').toISOString(),
}

it('refuses a handoff and a Partner change onto an unavailable Partner, and confirm passes both', async () => {
  const world = await office('puw-block')
  const away = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const free = await createPartner(world.dispatcher, { name: 'Slobodni Prijevoz' })
  const first = await world.transfer('Ana Anić')
  const second = await world.transfer('Ivo Ivić')
  const third = await world.transfer('Tea Tić')

  expect((await handOff(world.dispatcher, first.ride.id, away.id)).status).toBe(200)
  const saved = await call('POST', '/api/unavailability', world.dispatcher, { partnerId: away.id, ...windowTimes })
  expect(saved.status).toBe(200)
  const body = await saved.json()
  expect(body.coveredRides).toEqual([{ rideId: first.ride.id, pickupAt: at('2026-11-10T12:00').toISOString() }])
  expect(body.window).toMatchObject({ driverId: null, vehicleId: null, partnerId: away.id })

  const beforeRide = await rideRow(second.ride.id)
  const beforeVersion = await versionOf(second.ride.id)
  const beforeCounts = await counts(world.tenantId)
  const refused = await handOff(world.dispatcher, second.ride.id, away.id)
  expect(refused.status).toBe(409)
  expect(await refused.json()).toMatchObject({ data: { code: 'ride_unavailable' } })
  expect(await rideRow(second.ride.id)).toEqual(beforeRide)
  expect(await versionOf(second.ride.id)).toBe(beforeVersion)
  expect(await counts(world.tenantId)).toEqual(beforeCounts)

  expect((await handOff(world.dispatcher, second.ride.id, away.id, true)).status).toBe(200)
  expect(await rideRow(second.ride.id)).toMatchObject({ state: 'handed_off', partner_id: away.id })

  expect((await handOff(world.dispatcher, third.ride.id, free.id)).status).toBe(200)
  const changeBefore = await rideRow(third.ride.id)
  const changeVersion = await versionOf(third.ride.id)
  const changeCounts = await counts(world.tenantId)
  const change = await call('POST', `/api/rides/${third.ride.id}/partner`, world.dispatcher, {
    partnerId: away.id,
    version: changeVersion,
  })
  expect(change.status).toBe(409)
  expect(await change.json()).toMatchObject({ data: { code: 'ride_unavailable' } })
  expect(await rideRow(third.ride.id)).toEqual(changeBefore)
  expect(await versionOf(third.ride.id)).toBe(changeVersion)
  expect(await counts(world.tenantId)).toEqual(changeCounts)

  const passed = await call('POST', `/api/rides/${third.ride.id}/partner`, world.dispatcher, {
    partnerId: away.id,
    version: changeVersion,
    confirm: true,
  })
  expect(passed.status).toBe(200)
  expect(await rideRow(third.ride.id)).toMatchObject({ state: 'handed_off', partner_id: away.id })
})

it('shows the board warning while the Partner window covers the handed-off Ride, and drops it when the window is removed', async () => {
  const world = await office('puw-board')
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const recorded = await world.transfer('Ana Anić')
  expect((await handOff(world.dispatcher, recorded.ride.id, partner.id)).status).toBe(200)

  const quiet = await call('GET', '/api/transfers?date=2026-11-10', world.dispatcher)
  expect(quiet.status).toBe(200)
  const before = (await quiet.json()).rides.find((ride: { rideId: string }) => ride.rideId === recorded.ride.id)
  expect(before.warnings.unavailable).toBeUndefined()

  const saved = await (await call('POST', '/api/unavailability', world.dispatcher, { partnerId: partner.id, ...windowTimes })).json()
  const covered = await call('GET', '/api/transfers?date=2026-11-10', world.dispatcher)
  const warned = (await covered.json()).rides.find((ride: { rideId: string }) => ride.rideId === recorded.ride.id)
  expect(warned.warnings.unavailable).toEqual(['partner'])

  expect((await call('POST', `/api/unavailability/${saved.window.id}/remove`, world.dispatcher)).status).toBe(204)
  const cleared = await call('GET', '/api/transfers?date=2026-11-10', world.dispatcher)
  const after = (await cleared.json()).rides.find((ride: { rideId: string }) => ride.rideId === recorded.ride.id)
  expect(after.warnings.unavailable).toBeUndefined()
})

it('keeps a Partner window inside its Tenant, and refuses another Tenant\'s Partner', async () => {
  const left = await office('puw-left')
  const right = await office('puw-right')
  const partner = await createPartner(left.dispatcher, { name: 'Mora Transfer' })
  const other = await createPartner(right.dispatcher, { name: 'Tuđi Prijevoz' })

  expect((await call('POST', '/api/unavailability', left.driverSession, { partnerId: partner.id, ...windowTimes })).status).toBe(403)
  const saved = await call('POST', '/api/unavailability', left.dispatcher, { partnerId: partner.id, ...windowTimes })
  expect(saved.status).toBe(200)
  const windowId = (await saved.json()).window.id as string

  expect((await call('GET', `/api/partners/${partner.id}/unavailability`, right.dispatcher)).status).toBe(404)
  expect((await call('POST', '/api/unavailability', right.dispatcher, { partnerId: partner.id, ...windowTimes })).status).toBe(404)
  const listed = await call('GET', `/api/partners/${partner.id}/unavailability`, left.dispatcher)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toMatchObject({ windows: [{ id: windowId, partnerId: partner.id }] })

  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [left.tenantId])
    await expect(client.query(
      `insert into app.unavailability_windows (partner_id, starts_at, ends_at) values ($1, $2, $3)`,
      [other.id, windowTimes.startsAt, windowTimes.endsAt],
    )).rejects.toThrow(/unavailability_windows_partner_fk|foreign key/i)
    await client.query('rollback')
  }
  finally {
    client.release()
  }
})
