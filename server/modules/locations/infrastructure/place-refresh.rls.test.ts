import type { JobQueue, QueuedJob, TenantTransaction } from '../../../core/index'
import type { PlaceReferenceCheck } from '../maps-port'
import { loadEnvFile } from 'node:process'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { PLACE_REF_MAX_LENGTH } from '../../../../shared'
import { openTenantSession } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { PLACE_REFRESH_ASK, registerPlaceRefresh } from './place-refresh-worker'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * The nightly check on real rows (ADR-0052). Tenant A is refreshed.
 * Tenant B has a due reference and must stay as it was.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const ownerPool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL') })
const appPool = new pg.Pool({ connectionString: required('DATABASE_URL') })
const appDb = drizzle(appPool)

const tenantA = crypto.randomUUID()
const tenantB = crypto.randomUUID()
const askedAt = new Date('2026-10-23T03:00:00.000Z')
const freshAt = new Date('2026-10-22T03:00:00.000Z')
const officeAt = new Date('2026-10-23T03:00:05.000Z')
const tooLong = `ChIJ${'x'.repeat(PLACE_REF_MAX_LENGTH)}`

const kept = {
  same: 'ChIJsameA',
  replaced: 'ChIJreplacedA',
  gone: 'ChIJgoneA',
  unavailable: 'ChIJunavailableA',
  invalid: 'ChIJinvalidA',
  archived: 'ChIJarchivedA',
  fresh: 'ChIJfreshA',
  officeWas: 'ChIJofficeWas',
  officeNow: 'ChIJofficeNow',
  fromGoogle: 'ChIJfromGoogle',
  tenantB: 'ChIJtenantB',
  goneAddress: 'Put A gone',
  tenantBAddress: 'Put B secret',
} as const

afterAll(async () => {
  await ownerPool.query('delete from app.locations where tenant_id = any($1::uuid[])', [[tenantA, tenantB]])
  await ownerPool.end()
  await appPool.end()
})

async function seed(
  tenantId: string,
  name: string,
  kind: string,
  address: string,
  placeRef: string,
  checkedAt: Date | null,
  archived: boolean,
): Promise<void> {
  await ownerPool.query(
    `insert into app.locations (
       tenant_id, name, kind, address, place_provider, place_ref, place_ref_checked_at, archived_at
     )
     values ($1, $2, $3, $4, 'google', $5, $6, case when $7 then now() else null end)`,
    [tenantId, name, kind, address, placeRef, checkedAt, archived],
  )
}

interface Stored {
  name: string
  kind: string
  address: string | null
  place_provider: string | null
  place_ref: string | null
  checked: Date | null
  archived: boolean
}

async function stored(tenantId: string): Promise<Stored[]> {
  const rows = await ownerPool.query<Stored>(
    `select name, kind, address, place_provider, place_ref,
            place_ref_checked_at as checked,
            archived_at is not null as archived
     from app.locations
     where tenant_id = $1
     order by name`,
    [tenantId],
  )
  return rows.rows
}

function answerFor(placeRef: string): PlaceReferenceCheck {
  if (placeRef === kept.same)
    return { outcome: 'same' }
  if (placeRef === kept.replaced)
    return { outcome: 'replaced', placeRef: kept.fromGoogle }
  if (placeRef === kept.gone)
    return { outcome: 'gone' }
  if (placeRef === kept.unavailable)
    return { outcome: 'unavailable' }
  if (placeRef === kept.invalid)
    return { outcome: 'replaced', placeRef: tooLong }
  if (placeRef === kept.officeWas)
    return { outcome: 'replaced', placeRef: 'ChIJshouldNotWin' }
  return { outcome: 'unavailable' }
}

it('grants the due-tenant listing to the app role only', async () => {
  const listing = await ownerPool.query<{ app: boolean, auth: boolean, platform: boolean, queue: boolean }>(`
    select has_function_privilege('transferpro_app', 'app.tenants_due_place_refresh(timestamptz)', 'EXECUTE') as app,
           has_function_privilege('transferpro_auth', 'app.tenants_due_place_refresh(timestamptz)', 'EXECUTE') as auth,
           has_function_privilege('transferpro_platform', 'app.tenants_due_place_refresh(timestamptz)', 'EXECUTE') as platform,
           has_function_privilege('transferpro_queue', 'app.tenants_due_place_refresh(timestamptz)', 'EXECUTE') as queue
  `)
  expect(listing.rows).toEqual([{ app: true, auth: false, platform: false, queue: false }])
})

it('refreshes Tenant A and does not read or write Tenant B', async () => {
  await seed(tenantA, 'Same', 'hotel', 'Put same', kept.same, null, false)
  await seed(tenantA, 'Replaced', 'airport', 'Put replaced', kept.replaced, null, false)
  await seed(tenantA, 'Gone', 'hotel', kept.goneAddress, kept.gone, null, false)
  await seed(tenantA, 'Unavailable', 'other', 'Put unavailable', kept.unavailable, null, false)
  await seed(tenantA, 'Invalid', 'hotel', 'Put invalid', kept.invalid, null, false)
  await seed(tenantA, 'Archived', 'hotel', 'Put archived', kept.archived, null, true)
  await seed(tenantA, 'Fresh', 'hotel', 'Put fresh', kept.fresh, freshAt, false)
  await seed(tenantA, 'Office', 'hotel', 'Put office', kept.officeWas, null, false)
  await seed(tenantB, 'Tenant B', 'hotel', kept.tenantBAddress, kept.tenantB, null, false)

  const listed = await appPool.query<{ tenant_id: string }>(
    'select tenant_id from app.tenants_due_place_refresh($1)',
    [askedAt],
  )
  const ids = listed.rows.map(row => row.tenant_id)
  expect(ids).toContain(tenantA)
  expect(ids).toContain(tenantB)
  for (const row of listed.rows)
    expect(Object.keys(row)).toEqual(['tenant_id'])

  const auditBefore = await ownerPool.query<{ n: string }>(
    'select count(*) as n from app.audit_entry where tenant_id = any($1::uuid[])',
    [[tenantA, tenantB]],
  )

  const logs = captureLogs()
  let onCheck: ((job: QueuedJob, scope: { transaction: TenantTransaction }) => Promise<void>) | undefined
  const queue: JobQueue = {
    async enqueue() {},
    async handleNext() {
      return null
    },
    async schedule() {},
    async workScheduled() {},
    async work(_name, handle) {
      onCheck = handle
    },
    async close() {},
  }
  await registerPlaceRefresh(queue, {
    maps: 'google',
    log: logs.logger,
    now: () => askedAt,
    async listTenantIds() {
      return [tenantA]
    },
    places: {
      async checkPlaceRef(placeRef) {
        if (placeRef === kept.officeWas) {
          await ownerPool.query(
            `update app.locations
             set place_ref = $1, place_ref_checked_at = $2
             where tenant_id = $3 and place_ref = $4`,
            [kept.officeNow, officeAt, tenantA, kept.officeWas],
          )
        }
        return answerFor(placeRef)
      },
    },
  })

  const check = onCheck
  if (!check)
    throw new Error('check worker was not registered')
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: tenantA }, async () => {
      await check(
        { id: 'job-a', name: PLACE_REFRESH_ASK, tenantId: tenantA, data: { askedAt: askedAt.toISOString() } },
        { transaction },
      )
    })
  })

  const rowsA = await stored(tenantA)
  const byName = new Map(rowsA.map(row => [row.name, row]))
  expect(byName.get('Same')).toMatchObject({
    place_provider: 'google',
    place_ref: kept.same,
    address: 'Put same',
  })
  expect(byName.get('Same')?.checked?.toISOString()).toBe(askedAt.toISOString())
  expect(byName.get('Replaced')).toMatchObject({
    place_provider: 'google',
    place_ref: kept.fromGoogle,
    address: 'Put replaced',
  })
  expect(byName.get('Replaced')?.checked?.toISOString()).toBe(askedAt.toISOString())
  expect(byName.get('Gone')).toMatchObject({
    place_provider: null,
    place_ref: null,
    checked: null,
    address: kept.goneAddress,
  })
  expect(byName.get('Unavailable')).toMatchObject({
    place_provider: 'google',
    place_ref: kept.unavailable,
    checked: null,
  })
  expect(byName.get('Invalid')).toMatchObject({
    place_provider: 'google',
    place_ref: kept.invalid,
    checked: null,
  })
  expect(byName.get('Archived')).toMatchObject({
    place_provider: 'google',
    place_ref: kept.archived,
    checked: null,
    archived: true,
  })
  expect(byName.get('Fresh')).toMatchObject({
    place_provider: 'google',
    place_ref: kept.fresh,
  })
  expect(byName.get('Fresh')?.checked?.toISOString()).toBe(freshAt.toISOString())
  expect(byName.get('Office')).toMatchObject({
    place_provider: 'google',
    place_ref: kept.officeNow,
    address: 'Put office',
  })
  expect(byName.get('Office')?.checked?.toISOString()).toBe(officeAt.toISOString())

  expect(await stored(tenantB)).toEqual([{
    name: 'Tenant B',
    kind: 'hotel',
    address: kept.tenantBAddress,
    place_provider: 'google',
    place_ref: kept.tenantB,
    checked: null,
    archived: false,
  }])

  const auditAfter = await ownerPool.query<{ n: string }>(
    'select count(*) as n from app.audit_entry where tenant_id = any($1::uuid[])',
    [[tenantA, tenantB]],
  )
  expect(auditAfter.rows).toEqual(auditBefore.rows)

  const text = JSON.stringify(logs.lines())
  expect(logs.lines()[0]).toMatchObject({
    event: 'locations.place_refresh',
    same: 1,
    replaced: 2,
    gone: 1,
    unavailable: 1,
    invalid: 1,
    tripped: false,
  })
  for (const secret of [kept.same, kept.replaced, kept.fromGoogle, kept.gone, kept.goneAddress, kept.tenantB, kept.tenantBAddress, tooLong, kept.officeNow])
    expect(text).not.toContain(secret)
})
