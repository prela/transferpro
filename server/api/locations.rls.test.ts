import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { FAKE_PLACE_REF, lastTestMapsQuery, setTestMapsEmbedOff, setTestMapsUnavailable, TEST_SUGGESTIONS_UNAVAILABLE_COOKIE } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getLocations from './locations.get'
import postLocation from './locations.post'
import patchLocation from './locations/[id].patch'
import archiveLocation from './locations/[id]/archive.post'
import postEmbedMode from './locations/embed-mode.post'
import postSuggestionsMode from './locations/suggestions-mode.post'
import postSuggestions from './locations/suggestions.post'

/**
 * GET, POST, PATCH /api/locations, and POST /api/locations/:id/archive.
 * An invalid body is answered before a session exists. The role cases use
 * a real sign-in, the same way the screen will call these routes.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')
// The Embed is configured for this file. CI leaves MAPS unset, which is
// `none`, and then an active google place would carry a null URL.
process.env.MAPS = 'google'
if (process.env.MAPS_API_KEY === undefined || process.env.MAPS_API_KEY === '')
  process.env.MAPS_API_KEY = 'test-places-key'
process.env.MAPS_EMBED_KEY = 'test-embed-key'

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const password = 'locations-http-password'
const place = 'Zračna luka Dubrovnik'
const address = 'Dobrota bb, Čilipi'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/locations', (event) => {
  const pathOnly = event.path.split('?')[0] ?? '/'
  const rest = pathOnly === '/' ? '' : decodeURIComponent(pathOnly.slice(1))
  if (rest === '') {
    if (event.method === 'POST')
      return postLocation(event)
    return getLocations(event)
  }
  if (rest === 'suggestions')
    return postSuggestions(event)
  if (rest === 'suggestions-mode')
    return postSuggestionsMode(event)
  if (rest === 'embed-mode')
    return postEmbedMode(event)
  const [id, action] = rest.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'archive')
    return archiveLocation(event)
  return patchLocation(event)
})
const callLocations = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'hlc-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hlc-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hlc-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hlc-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hlc-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hlc-%'`)
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

async function tenant(slug: string, adminName: string) {
  return createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName,
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
}

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<string> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, name, email],
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
  return userId
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

function call(method: string, path: string, session?: Headers, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return callLocations(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function locationBody(overrides: Record<string, unknown> = {}) {
  return {
    name: place,
    kind: 'airport',
    address,
    ...overrides,
  }
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'location.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

it('post answers 400 for a bad body and does not echo the address, and no session is 401', async () => {
  const refused = await call('POST', '/api/locations', undefined, { name: ' ', kind: 'airport', address })
  expect(refused.status).toBe(400)
  expect(await refused.text()).not.toContain(address)
  expect((await call('GET', '/api/locations')).status).toBe(401)
  expect((await call('GET', '/api/locations?includeArchived=maybe')).status).toBe(400)
  expect((await call('GET', '/api/locations?includeArchived=')).status).toBe(400)
  expect((await call('GET', '/api/locations?includeArchived=false')).status).toBe(401)
  expect((await call('PATCH', '/api/locations/not-a-uuid', undefined, { name: place })).status).toBe(400)
})

it('a dispatcher and an admin can add, correct, list, and archive a Location, and a driver is refused', async () => {
  const created = await tenant('hlc-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hlc-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hlc-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hlc-roles-admin@example.test')
  const dispatcher = await signIn('hlc-roles-dispatcher@example.test')
  const driver = await signIn('hlc-roles-driver@example.test')

  const refused = await call('POST', '/api/locations', driver, locationBody({ name: 'Skriveno' }))
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(address)
  expect((await call('GET', '/api/locations', driver)).status).toBe(403)
  expect((await call('PATCH', '/api/locations/a1b2c3d4-5555-4555-8555-555555555555', driver, { kind: 'hotel' })).status).toBe(403)
  expect((await call('POST', '/api/locations/a1b2c3d4-5555-4555-8555-555555555555/archive', driver)).status).toBe(403)

  const added = await call('POST', '/api/locations', dispatcher, locationBody({ name: `  ${place}  `, address: `  ${address}  ` }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row).toEqual({
    id: expect.any(String),
    name: place,
    kind: 'airport',
    address,
    iata: null,
    place: null,
    archivedAt: null,
    embedUrl: null,
  })

  const listed = await call('GET', '/api/locations', admin)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({ locations: [row] })

  const same = await call('PATCH', `/api/locations/${row.id}`, dispatcher, { name: place })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(row)

  const corrected = await call('PATCH', `/api/locations/${row.id}`, admin, {
    name: 'Hotel Excelsior',
    kind: 'hotel',
    address: null,
  })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({
    id: row.id,
    name: 'Hotel Excelsior',
    kind: 'hotel',
    address: null,
    archivedAt: null,
  })

  expect((await call('PATCH', `/api/locations/${row.id}`, driver, { kind: 'other' })).status).toBe(403)
  expect((await call('POST', `/api/locations/${row.id}/archive`, driver)).status).toBe(403)
  const untouched = await call('GET', '/api/locations', admin)
  expect(await untouched.json()).toEqual({
    locations: [expect.objectContaining({
      id: row.id,
      name: 'Hotel Excelsior',
      kind: 'hotel',
      address: null,
      archivedAt: null,
    })],
  })

  const archived = await call('POST', `/api/locations/${row.id}/archive`, dispatcher)
  expect(archived.status).toBe(200)
  const archivedRow = await archived.json()
  expect(archivedRow.archivedAt).toEqual(expect.any(String))

  const frozen = await call('PATCH', `/api/locations/${row.id}`, admin, { kind: 'address' })
  expect(frozen.status).toBe(409)
  const frozenText = await frozen.text()
  expect(frozenText).not.toContain('Hotel Excelsior')
  expect(frozenText).not.toContain(address)

  const hidden = await call('GET', '/api/locations', dispatcher)
  expect(await hidden.json()).toEqual({ locations: [] })

  const withArchived = await call('GET', '/api/locations?includeArchived=true', admin)
  expect(await withArchived.json()).toEqual({
    locations: [expect.objectContaining({
      id: row.id,
      name: 'Hotel Excelsior',
      kind: 'hotel',
      address: null,
      archivedAt: expect.any(String),
    })],
  })

  const again = await call('POST', `/api/locations/${row.id}/archive`, admin)
  expect(again.status).toBe(200)
  expect((await again.json()).archivedAt).toBe(archivedRow.archivedAt)

  const missing = 'a1b2c3d4-5555-4555-8555-555555555555'
  expect((await call('PATCH', `/api/locations/${missing}`, admin, { kind: 'other' })).status).toBe(404)
  expect((await call('POST', `/api/locations/${missing}/archive`, admin)).status).toBe(404)

  const rows = await auditRows(created.tenantId)
  expect(rows.every(entry => entry.subject_user_id === null)).toBe(true)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(place)
  expect(text).not.toContain(address)
  expect(text).not.toContain('Hotel Excelsior')
  expect(rows.map(entry => entry.action)).toContain('location.created')
  expect(rows.map(entry => entry.action)).toContain('location.archived')
  const fieldChanges = rows.filter(entry => entry.action === 'location.field_changed').map(entry => entry.data)
  expect(fieldChanges).toHaveLength(3)
  expect(fieldChanges).toEqual(expect.arrayContaining([
    { locationId: row.id, field: 'name' },
    { locationId: row.id, field: 'kind' },
    { locationId: row.id, field: 'address' },
  ]))
  const createdEntry = rows.find(entry => entry.action === 'location.created')
  expect(createdEntry?.data).toEqual({
    locationId: row.id,
    fields: ['name', 'kind', 'address'],
  })
})

it('another Tenant cannot read or change these Locations', async () => {
  await tenant('hlc-iso-a', 'Ana Admin')
  await tenant('hlc-iso-b', 'Boris Admin')
  const adminA = await signIn('hlc-iso-a-admin@example.test')
  const adminB = await signIn('hlc-iso-b-admin@example.test')

  const added = await call('POST', '/api/locations', adminA, locationBody({ name: 'Hotel Park', address: null, iata: 'dbv' }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row.iata).toBe('DBV')

  expect(await (await call('GET', '/api/locations', adminB)).json()).toEqual({ locations: [] })
  expect((await call('GET', '/api/locations?includeArchived=true', adminB)).status).toBe(200)
  expect(await (await call('GET', '/api/locations?includeArchived=true', adminB)).json()).toEqual({ locations: [] })
  expect((await call('PATCH', `/api/locations/${row.id}`, adminB, { kind: 'other' })).status).toBe(404)
  expect((await call('POST', `/api/locations/${row.id}/archive`, adminB)).status).toBe(404)
  expect((await call('PATCH', `/api/locations/${row.id}`, adminB, { iata: 'SPU' })).status).toBe(404)
  expect(await (await call('GET', '/api/locations', adminA)).json()).toEqual({
    locations: [expect.objectContaining({ id: row.id, name: 'Hotel Park', iata: 'DBV' })],
  })
})

it('sets an airport code, refuses a bad code and a code on a hotel, clears it when the kind changes, and an archived Location cannot gain one', async () => {
  const created = await tenant('hlc-iata', 'Iva Admin')
  await addMember(created.tenantId, 'hlc-iata-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hlc-iata-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hlc-iata-admin@example.test')
  const dispatcher = await signIn('hlc-iata-dispatcher@example.test')
  const driver = await signIn('hlc-iata-driver@example.test')

  const added = await call('POST', '/api/locations', dispatcher, locationBody({ iata: ' dbv ' }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row.iata).toBe('DBV')

  const bad = await call('PATCH', `/api/locations/${row.id}`, admin, { iata: 'Dubrovnik' })
  expect(bad.status).toBe(400)
  const badText = await bad.text()
  expect(badText).not.toContain('Dubrovnik')
  expect(badText).not.toContain('DBV')

  const hotel = await call('POST', '/api/locations', dispatcher, { name: 'Hotel Park', kind: 'hotel', iata: 'SPU' })
  expect(hotel.status).toBe(400)
  const hotelRow = await (await call('POST', '/api/locations', dispatcher, { name: 'Hotel Park', kind: 'hotel' })).json()
  expect(hotelRow.iata).toBeNull()
  const before = await auditRows(created.tenantId)
  expect((await call('PATCH', `/api/locations/${hotelRow.id}`, admin, { iata: 'SPU' })).status).toBe(400)

  expect((await call('PATCH', `/api/locations/${row.id}`, driver, { iata: 'SPU' })).status).toBe(403)
  const untouched = await (await call('GET', '/api/locations', admin)).json()
  expect(untouched.locations).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: row.id, iata: 'DBV' }),
    expect.objectContaining({ id: hotelRow.id, iata: null }),
  ]))
  expect(await auditRows(created.tenantId)).toEqual(before)

  const cleared = await call('PATCH', `/api/locations/${row.id}`, dispatcher, { iata: '   ' })
  expect(cleared.status).toBe(200)
  expect((await cleared.json()).iata).toBeNull()

  const again = await call('PATCH', `/api/locations/${row.id}`, admin, { iata: 'dbv' })
  expect((await again.json()).iata).toBe('DBV')

  const moved = await call('PATCH', `/api/locations/${row.id}`, dispatcher, { kind: 'address' })
  expect(moved.status).toBe(200)
  expect(await moved.json()).toMatchObject({ kind: 'address', iata: null })

  const airport = await (await call('POST', '/api/locations', admin, { name: 'Zračna luka Split', kind: 'airport', iata: 'SPU' })).json()
  expect((await call('POST', `/api/locations/${airport.id}/archive`, dispatcher)).status).toBe(200)
  const frozen = await call('PATCH', `/api/locations/${airport.id}`, admin, { iata: 'DBV' })
  expect(frozen.status).toBe(409)
  const listed = await (await call('GET', '/api/locations?includeArchived=true', admin)).json()
  expect(listed.locations).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: airport.id, iata: 'SPU' }),
  ]))

  const rows = await auditRows(created.tenantId)
  const text = JSON.stringify(rows)
  expect(text).not.toContain('DBV')
  expect(text).not.toContain('SPU')
  expect(text).not.toContain('Dubrovnik')
  const createdEntry = rows.find(entry => entry.action === 'location.created' && entry.data && typeof entry.data === 'object' && 'locationId' in entry.data && entry.data.locationId === row.id)
  expect(createdEntry?.data).toEqual({ locationId: row.id, fields: ['name', 'kind', 'address', 'iata'] })
  const fieldChanges = rows.filter(entry => entry.action === 'location.field_changed').map(entry => entry.data)
  expect(fieldChanges).toEqual(expect.arrayContaining([
    { locationId: row.id, field: 'iata' },
    { locationId: row.id, field: 'kind' },
  ]))
})

it('refuses a second active airport code in the same Tenant and allows it in another', async () => {
  await tenant('hlc-iata-a', 'Ana Kod')
  await tenant('hlc-iata-b', 'Boris Kod')
  const adminA = await signIn('hlc-iata-a-admin@example.test')
  const adminB = await signIn('hlc-iata-b-admin@example.test')

  const first = await call('POST', '/api/locations', adminA, { name: 'Zračna luka Zadar', kind: 'airport', iata: 'zad' })
  expect(first.status).toBe(200)
  const duplicate = await call('POST', '/api/locations', adminA, { name: 'Zračna luka Zadar 2', kind: 'airport', iata: 'ZAD' })
  expect(duplicate.status).toBe(409)
  const duplicateText = await duplicate.text()
  expect(duplicateText).toContain('location_iata_taken')
  expect(duplicateText).not.toContain('ZAD')
  expect(duplicateText).not.toContain('Zadar')

  const other = await call('POST', '/api/locations', adminB, { name: 'Zračna luka Zadar', kind: 'airport', iata: 'ZAD' })
  expect(other.status).toBe(200)
  expect((await other.json()).iata).toBe('ZAD')
  expect(await (await call('GET', '/api/locations', adminB)).json()).toEqual({
    locations: [expect.objectContaining({ name: 'Zračna luka Zadar', iata: 'ZAD' })],
  })
  expect(await (await call('GET', '/api/locations', adminA)).text()).not.toContain('Zračna luka Zadar 2')
})

it('suggests for the office in the Tenant language, refuses a driver, and does not audit the lookup', async () => {
  setTestMapsUnavailable(false)
  const created = await tenant('hlc-maps', 'Maja Admin')
  await addMember(created.tenantId, 'hlc-maps-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hlc-maps-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hlc-maps-admin@example.test')
  const dispatcher = await signIn('hlc-maps-dispatcher@example.test')
  const driver = await signIn('hlc-maps-driver@example.test')
  const typed = 'Villa Rosa 12'
  const token = 'b1b2c3d4-5555-4555-8555-555555555555'
  const before = await auditRows(created.tenantId)

  const unsigned = await call('POST', '/api/locations/suggestions', undefined, { text: typed, sessionToken: token })
  expect(unsigned.status).toBe(401)
  expect(await unsigned.text()).not.toContain(typed)

  const short = await call('POST', '/api/locations/suggestions', undefined, { text: 'ab', sessionToken: token })
  expect(short.status).toBe(400)
  expect(await short.text()).not.toContain('ab')

  const extra = await call('POST', '/api/locations/suggestions', undefined, { text: typed, sessionToken: token, region: 'HR' })
  expect(extra.status).toBe(400)
  expect(await extra.text()).not.toContain(typed)

  const refused = await call('POST', '/api/locations/suggestions', driver, { text: typed, sessionToken: token })
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(typed)

  const suggested = await call('POST', '/api/locations/suggestions', dispatcher, { text: `  ${typed}  `, sessionToken: token })
  expect(suggested.status).toBe(200)
  expect(await suggested.json()).toEqual({
    available: true,
    attribution: 'Google',
    suggestions: [{
      text: `${typed}, Dubrovnik`,
      provider: 'google',
      placeRef: FAKE_PLACE_REF,
    }],
  })
  expect(lastTestMapsQuery()).toEqual({ text: typed, sessionToken: token, language: 'hr' })

  await ownerPool.query(`update app.tenant_settings set default_locale = 'en' where tenant_id = $1`, [created.tenantId])
  const english = await call('POST', '/api/locations/suggestions', admin, { text: typed, sessionToken: token })
  expect(english.status).toBe(200)
  expect(lastTestMapsQuery()?.language).toBe('en')
  expect(await auditRows(created.tenantId)).toEqual(before)

  const picked = await call('POST', '/api/locations', dispatcher, {
    name: 'Villa Rosa',
    kind: 'address',
    address: `${typed}, Dubrovnik`,
    place: { provider: 'google', placeRef: FAKE_PLACE_REF },
  })
  expect(picked.status).toBe(200)
  const row = await picked.json()
  expect(row.place).toEqual({ provider: 'google', placeRef: FAKE_PLACE_REF })

  const bare = await call('POST', '/api/locations', dispatcher, {
    name: 'Bez adrese',
    kind: 'address',
    place: { provider: 'google', placeRef: FAKE_PLACE_REF },
  })
  expect(bare.status).toBe(400)
  const bareText = await bare.text()
  expect(bareText).not.toContain(FAKE_PLACE_REF)
  expect(bareText).not.toContain(typed)

  const edited = await call('PATCH', `/api/locations/${row.id}`, admin, { address: 'Put 9' })
  expect(edited.status).toBe(200)
  expect(await edited.json()).toMatchObject({ address: 'Put 9', place: null })

  const rows = await auditRows(created.tenantId)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(typed)
  expect(text).not.toContain(FAKE_PLACE_REF)
  expect(text).not.toContain('google')
  expect(rows.map(entry => entry.data)).toEqual(expect.arrayContaining([
    { locationId: row.id, fields: ['name', 'kind', 'address', 'placeRef'] },
    { locationId: row.id, field: 'address' },
    { locationId: row.id, field: 'placeRef' },
  ]))
})

function embedFragment(url: string): { placeRef: string | null, language: string | null } {
  const parsed = new URL(url)
  const fragment = new URLSearchParams(parsed.hash.slice(1))
  return {
    placeRef: fragment.get('placeRef'),
    language: fragment.get('language'),
  }
}

it('carries an Embed URL for an active google place, and null when there is no map', async () => {
  setTestMapsEmbedOff(false)
  try {
    const created = await tenant('hlc-embed', 'Ema Admin')
    await addMember(created.tenantId, 'hlc-embed-dispatcher@example.test', 'Edo Dispatcher', 'dispatcher')
    await addMember(created.tenantId, 'hlc-embed-driver@example.test', 'Ena Driver', 'driver')
    const admin = await signIn('hlc-embed-admin@example.test')
    const dispatcher = await signIn('hlc-embed-dispatcher@example.test')
    const driver = await signIn('hlc-embed-driver@example.test')
    const placeRef = 'ChIJofficePlace'
    const placeName = 'Zračna luka Embed'
    const placeAddress = 'Dobrota bb, Čilipi'

    const typed = await call('POST', '/api/locations', dispatcher, {
      name: 'Kuća Mira',
      kind: 'address',
      address: 'Put 9',
    })
    expect(typed.status).toBe(200)
    expect((await typed.json()).embedUrl).toBeNull()

    const added = await call('POST', '/api/locations', admin, {
      name: placeName,
      kind: 'airport',
      address: placeAddress,
      iata: 'EMB',
      place: { provider: 'google', placeRef },
    })
    expect(added.status).toBe(200)
    const row = await added.json()
    expect(row.embedUrl.startsWith('about:blank#')).toBe(true)
    expect(embedFragment(row.embedUrl)).toEqual({ placeRef, language: 'hr' })
    expect(row.embedUrl).not.toContain(placeName)
    expect(row.embedUrl).not.toContain(placeAddress)
    expect(row.embedUrl).not.toContain('test-embed-key')

    await authPool.query(`update auth."user" set locale = 'en' where email = $1`, ['hlc-embed-dispatcher@example.test'])
    const english = await call('GET', '/api/locations', dispatcher)
    expect(english.status).toBe(200)
    const englishBody = await english.json()
    const englishRow = englishBody.locations.find((location: { id: string }) => location.id === row.id)
    expect(embedFragment(englishRow.embedUrl)).toEqual({ placeRef, language: 'en' })
    expect(englishBody.locations.find((location: { name: string }) => location.name === 'Kuća Mira').embedUrl).toBeNull()
    expect(JSON.stringify(englishBody)).not.toContain('test-embed-key')

    const croatian = await call('GET', '/api/locations', admin)
    const croatianRow = (await croatian.json()).locations.find((location: { id: string }) => location.id === row.id)
    expect(embedFragment(croatianRow.embedUrl).language).toBe('hr')

    expect((await call('GET', '/api/locations', driver)).status).toBe(403)

    const archived = await call('POST', `/api/locations/${row.id}/archive`, admin)
    expect(archived.status).toBe(200)
    expect((await archived.json()).embedUrl).toBeNull()
    const withArchived = await call('GET', '/api/locations?includeArchived=true', admin)
    const archivedRow = (await withArchived.json()).locations.find((location: { id: string }) => location.id === row.id)
    expect(archivedRow.embedUrl).toBeNull()

    const hotel = await call('POST', '/api/locations', dispatcher, {
      name: 'Hotel Embed',
      kind: 'hotel',
      address: 'Ulica 1',
      place: { provider: 'google', placeRef: 'ChIJhotelEmbed' },
    })
    expect(hotel.status).toBe(200)
    expect(embedFragment((await hotel.json()).embedUrl)).toEqual({ placeRef: 'ChIJhotelEmbed', language: 'en' })

    const off = await call('POST', '/api/locations/embed-mode', admin, { off: true })
    expect(off.status).toBe(200)
    const hidden = await call('GET', '/api/locations', admin)
    const hiddenRow = (await hidden.json()).locations.find((location: { name: string }) => location.name === 'Hotel Embed')
    expect(hiddenRow.embedUrl).toBeNull()
  }
  finally {
    setTestMapsEmbedOff(false)
  }
})

async function checkedAt(locationId: string): Promise<Date | null> {
  const result = await ownerPool.query<{ place_ref_checked_at: Date | null }>(
    'select place_ref_checked_at from app.locations where id = $1',
    [locationId],
  )
  const value = result.rows[0]?.place_ref_checked_at ?? null
  return value === null ? null : new Date(value)
}

it('stamps a pick, keeps the time when the reference stays, and clears it on a hand edit or a clear', async () => {
  const created = await tenant('hlc-checked', 'Cila Admin')
  await tenant('hlc-checked-b', 'Ciro Admin')
  const admin = await signIn('hlc-checked-admin@example.test')
  const other = await signIn('hlc-checked-b-admin@example.test')
  const placeRef = 'ChIJcheckedPlace'
  const nextRef = 'ChIJcheckedNext'

  const picked = await call('POST', '/api/locations', admin, {
    name: 'Hotel Check',
    kind: 'hotel',
    address: 'Put 4',
    place: { provider: 'google', placeRef },
  })
  expect(picked.status).toBe(200)
  const row = await picked.json()
  expect(row.place).toEqual({ provider: 'google', placeRef })
  expect(row.placeRefCheckedAt).toBeUndefined()
  const stamped = await checkedAt(row.id)
  expect(stamped).not.toBeNull()
  expect(Math.abs((stamped?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000)
  const ownerRow = await ownerPool.query<{ tenant_id: string }>(
    'select tenant_id from app.locations where id = $1',
    [row.id],
  )
  expect(ownerRow.rows[0]?.tenant_id).toBe(created.tenantId)

  const listed = await call('GET', '/api/locations', other)
  expect(listed.status).toBe(200)
  expect(await listed.text()).not.toContain(row.id)
  const refused = await call('PATCH', `/api/locations/${row.id}`, other, { name: 'Hotel Stolen' })
  expect(refused.status).toBe(404)
  expect((await checkedAt(row.id))?.toISOString()).toBe(stamped?.toISOString())

  const kept = await call('PATCH', `/api/locations/${row.id}`, admin, { name: 'Hotel Check 2' })
  expect(kept.status).toBe(200)
  expect((await kept.json()).place).toEqual({ provider: 'google', placeRef })
  expect((await checkedAt(row.id))?.toISOString()).toBe(stamped?.toISOString())

  const edited = await call('PATCH', `/api/locations/${row.id}`, admin, { address: 'Put 5' })
  expect(edited.status).toBe(200)
  expect((await edited.json()).place).toBeNull()
  expect(await checkedAt(row.id)).toBeNull()

  const again = await call('PATCH', `/api/locations/${row.id}`, admin, {
    address: 'Put 6',
    place: { provider: 'google', placeRef: nextRef },
  })
  expect(again.status).toBe(200)
  expect(await checkedAt(row.id)).not.toBeNull()

  const cleared = await call('PATCH', `/api/locations/${row.id}`, admin, { place: null })
  expect(cleared.status).toBe(200)
  const clearedBody = await cleared.json()
  expect(clearedBody.place).toBeNull()
  expect(clearedBody.address).toBe('Put 6')
  expect(await checkedAt(row.id)).toBeNull()
})

it('hides suggestions for the caller that turned them off, and not for another caller', async () => {
  setTestMapsUnavailable(false)
  const created = await tenant('hlc-cookie', 'Cookie Admin')
  const admin = await signIn('hlc-cookie-admin@example.test')
  const mode = await call('POST', '/api/locations/suggestions-mode', undefined, { unavailable: true })
  expect(mode.status).toBe(200)
  const switched = mode.headers.getSetCookie().map(part => part.split(';')[0]).join('; ')
  expect(switched).toContain(`${TEST_SUGGESTIONS_UNAVAILABLE_COOKIE}=1`)
  const caller = new Headers(admin)
  caller.set('cookie', `${admin.get('cookie')}; ${switched}`)
  const body = {
    text: 'Put 4',
    sessionToken: 'c1b2c3d4-5555-4555-8555-555555555556',
  }
  const hidden = await call('POST', '/api/locations/suggestions', caller, body)
  expect(hidden.status).toBe(200)
  expect(await hidden.json()).toEqual({ available: false, suggestions: [], attribution: null })
  const open = await call('POST', '/api/locations/suggestions', admin, body)
  expect(open.status).toBe(200)
  expect(await open.json()).toMatchObject({ available: true })
  expect(created.tenantId).toBeTruthy()
})

it('saves a typed address as plain text when suggestions are off', async () => {
  setTestMapsUnavailable(true)
  try {
    const created = await tenant('hlc-plain', 'Pia Admin')
    const admin = await signIn('hlc-plain-admin@example.test')
    const typed = 'Ulica bez mjesta 1'
    const suggestions = await call('POST', '/api/locations/suggestions', admin, {
      text: typed,
      sessionToken: 'c1b2c3d4-5555-4555-8555-555555555555',
    })
    expect(suggestions.status).toBe(200)
    expect(await suggestions.json()).toEqual({ available: false, suggestions: [], attribution: null })

    const saved = await call('POST', '/api/locations', admin, {
      name: 'Kuća Pia',
      kind: 'address',
      address: typed,
    })
    expect(saved.status).toBe(200)
    const row = await saved.json()
    expect(row.place).toBeNull()
    expect(row.address).toBe(typed)
    expect(await checkedAt(row.id)).toBeNull()
    expect(created.tenantId).toBeTruthy()
  }
  finally {
    setTestMapsUnavailable(false)
  }
})
