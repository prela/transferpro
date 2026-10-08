import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'

/**
 * The audit table on its own (ADR-0014): which session reads which rows, the
 * one write path, and that no role changes or removes a row. Rows and
 * Postgres error codes are the observation, not the policy text. Tenant and
 * user ids are fresh uuids, because an entry has no foreign key.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const appPool = new pg.Pool({ connectionString: required('DATABASE_URL') })
const authPool = new pg.Pool({ connectionString: required('AUTH_DATABASE_URL') })
const ownerPool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL') })

afterAll(async () => {
  await appPool.end()
  await authPool.end()
  await ownerPool.end()
})

const insufficientPrivilege = { code: '42501' }

/** One transaction with `app.tenant_id` set, as a tenant session does. Null leaves it unset. */
async function inSession<T>(pool: pg.Pool, tenantId: string | null, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (tenantId !== null)
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
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

/** The statement's error. The transaction always rolls back, so a missed refusal changes nothing. */
async function refusal(pool: pg.Pool, tenantId: string | null, text: string, values: unknown[] = []): Promise<unknown> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (tenantId !== null)
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    return await client.query(text, values).then(() => undefined, (error: unknown) => error)
  }
  finally {
    await client.query('rollback')
    client.release()
  }
}

async function appendRemoval(pool: pg.Pool, tenantId: string, actorUserId: string, subjectUserId: string): Promise<void> {
  await inSession(pool, tenantId, client => client.query(
    `select audit.append_entry('member.removed', $1, $2, '{"role":"driver"}'::jsonb)`,
    [actorUserId, subjectUserId],
  ))
}

async function entriesOf(tenantId: string) {
  const result = await ownerPool.query(
    `select tenant_id, action, actor_user_id, subject_user_id, data
     from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return result.rows
}

it('a session reads its own Tenant\'s entries only, and no session reads none', async () => {
  const tenantA = crypto.randomUUID()
  const tenantB = crypto.randomUUID()
  const actorA = crypto.randomUUID()
  const actorB = crypto.randomUUID()
  await appendRemoval(appPool, tenantA, actorA, crypto.randomUUID())
  await appendRemoval(appPool, tenantB, actorB, crypto.randomUUID())

  const seenByB = await inSession(appPool, tenantB, async client =>
    (await client.query('select tenant_id, actor_user_id from app.audit_entry')).rows)
  expect(seenByB).toEqual([{ tenant_id: tenantB, actor_user_id: actorB }])

  const aFromB = await inSession(appPool, tenantB, async client =>
    (await client.query('select id from app.audit_entry where tenant_id = $1', [tenantA])).rows)
  expect(aFromB).toEqual([])

  const noSession = await inSession(appPool, null, async client =>
    (await client.query('select id from app.audit_entry')).rows)
  expect(noSession).toEqual([])

  expect(await entriesOf(tenantA)).toHaveLength(1)
})

it('append_entry writes into the caller\'s session Tenant for the app and auth roles, and refuses without one', async () => {
  const tenantA = crypto.randomUUID()
  const tenantB = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const subject = crypto.randomUUID()

  await appendRemoval(appPool, tenantA, actor, subject)
  await appendRemoval(authPool, tenantB, actor, subject)
  const expected = { action: 'member.removed', actor_user_id: actor, subject_user_id: subject, data: { role: 'driver' } }
  expect(await entriesOf(tenantA)).toEqual([{ tenant_id: tenantA, ...expected }])
  expect(await entriesOf(tenantB)).toEqual([{ tenant_id: tenantB, ...expected }])

  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  expect(await refusal(appPool, null, append, ['member.removed', actor, subject, '{}'])).toMatchObject(insufficientPrivilege)
  expect(await refusal(authPool, null, append, ['member.removed', actor, subject, '{}'])).toMatchObject(insufficientPrivilege)
  // Not an action, no actor, data that is not an object.
  expect(await refusal(appPool, tenantA, append, ['member.left', actor, subject, '{}'])).toMatchObject({ code: '22P02' })
  expect(await refusal(appPool, tenantA, append, ['member.removed', '', subject, '{}'])).toMatchObject({ code: '23514' })
  expect(await refusal(appPool, tenantA, append, ['member.removed', actor, subject, '[]'])).toMatchObject({ code: '23514' })
  expect(await entriesOf(tenantA)).toHaveLength(1)
})

it('the table refuses data that does not match its action, for every writer', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const subject = crypto.randomUUID()
  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  const mismatches: Array<[string, string | null, string]> = [
    ['member.removed', subject, '{"role":"driver","email":"ana@example.test"}'],
    ['member.removed', subject, '{"role":"owner"}'],
    ['member.removed', subject, '{}'],
    ['member.removed', null, '{"role":"driver"}'],
    ['member.invited', subject, '{"role":"driver"}'],
    ['member.invited', null, '{"role":null}'],
    ['member.role_changed', subject, '{"from":"driver"}'],
    ['member.role_changed', subject, '{"from":"driver","to":"dispatcher","name":"Ana"}'],
    ['settings.airport_wait_changed', null, '{"from":90,"to":120,"email":"ana@example.test"}'],
    ['settings.airport_wait_changed', subject, '{"from":90,"to":120}'],
    ['settings.airport_wait_changed', null, '{"from":0,"to":90}'],
    ['settings.airport_wait_changed', null, '{"from":90.5,"to":120}'],
    ['settings.airport_wait_changed', null, '{"from":1441,"to":90}'],
    ['settings.elsewhere_wait_changed', null, '{"from":"25","to":30}'],
    ['settings.time_zone_changed', null, '{"from":"Europe/Zagreb","to":"Europe/Berlin","name":"Ana"}'],
    ['settings.time_zone_changed', null, '{"from":"","to":"Europe/Zagreb"}'],
    ['settings.time_zone_changed', subject, '{"from":"Europe/Zagreb","to":"Europe/Berlin"}'],
    ['client.created', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","kind":"agency","name":"Mora"}'],
    ['client.created', subject, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","kind":"agency"}'],
    ['client.name_changed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","from":"Mora","to":"Mora d.o.o."}'],
    ['client.kind_changed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","from":"hotel","to":"partner"}'],
  ]
  for (const values of mismatches) {
    expect(await refusal(appPool, tenant, append, [values[0], actor, ...values.slice(1)]), values.join(' ')).toMatchObject({ code: '23514' })
    expect(await refusal(authPool, tenant, append, [values[0], actor, ...values.slice(1)]), values.join(' ')).toMatchObject({ code: '23514' })
  }
  // The owner bypasses RLS and the function, as the invitation trigger does.
  expect(await refusal(ownerPool, null, `insert into app.audit_entry (tenant_id, action, actor_user_id, data)
    values ($1, 'member.invited', $2, '{"role":"driver","email":"ana@example.test"}')`, [tenant, actor])).toMatchObject({ code: '23514' })
  expect(await entriesOf(tenant)).toEqual([])
})

it('append_entry accepts a client action that carries the id and the kind, and not the name', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
  const append = `select audit.append_entry($1, $2, null, $3::jsonb)`
  await inSession(appPool, tenant, client => client.query(append, [
    'client.created',
    actor,
    JSON.stringify({ clientId, kind: 'agency' }),
  ]))
  await inSession(appPool, tenant, client => client.query(append, [
    'client.name_changed',
    actor,
    JSON.stringify({ clientId }),
  ]))
  await inSession(appPool, tenant, client => client.query(append, [
    'client.kind_changed',
    actor,
    JSON.stringify({ clientId, from: 'agency', to: 'hotel' }),
  ]))
  const rows = await entriesOf(tenant)
  expect(rows.map(row => row.action).sort()).toEqual(['client.created', 'client.kind_changed', 'client.name_changed'])
  expect(rows.every(row => row.data !== null && typeof row.data === 'object' && !Object.hasOwn(row.data, 'name'))).toBe(true)
})

it('append_entry accepts an office acceptance by phone with the Ride id, the Driver id, and the field name state, and refuses an extra key or other fields', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  const valid = { rideId, driverId, fields: ['state'] }
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.accepted_by_phone',
    actor,
    null,
    JSON.stringify(valid),
  ]))
  expect(await entriesOf(tenant)).toEqual([{
    tenant_id: tenant,
    action: 'ride.accepted_by_phone',
    actor_user_id: actor,
    subject_user_id: null,
    data: valid,
  }])

  const extraKey = await refusal(appPool, tenant, append, [
    'ride.accepted_by_phone',
    actor,
    null,
    JSON.stringify({ ...valid, phone: '+38591111' }),
  ])
  expect(extraKey).toMatchObject({ code: '23514' })

  const otherFields = await refusal(appPool, tenant, append, [
    'ride.accepted_by_phone',
    actor,
    null,
    JSON.stringify({ ...valid, fields: ['state', 'mustAccept'] }),
  ])
  expect(otherFields).toMatchObject({ code: '23514' })

  expect(await entriesOf(tenant)).toHaveLength(1)
})

it('the app role cannot insert, update, delete, or truncate an entry, even in its own Tenant, and the auth role cannot touch the table', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  await appendRemoval(appPool, tenant, actor, crypto.randomUUID())
  const before = await entriesOf(tenant)

  const statements = [
    `insert into app.audit_entry (action, actor_user_id, data) values ('member.removed', 'forged', '{}')`,
    `update app.audit_entry set actor_user_id = 'forged'`,
    'delete from app.audit_entry',
    'truncate app.audit_entry',
  ]
  for (const statement of statements) {
    expect(await refusal(appPool, tenant, statement), statement).toMatchObject(insufficientPrivilege)
    expect(await refusal(authPool, tenant, statement), statement).toMatchObject(insufficientPrivilege)
  }
  expect(await refusal(authPool, tenant, 'select id from app.audit_entry')).toMatchObject(insufficientPrivilege)
  expect(await entriesOf(tenant)).toEqual(before)
})

it('the owner cannot update, delete, or truncate an entry either', async () => {
  const tenant = crypto.randomUUID()
  await appendRemoval(appPool, tenant, crypto.randomUUID(), crypto.randomUUID())
  const before = await entriesOf(tenant)

  for (const statement of [
    `update app.audit_entry set actor_user_id = 'forged' where tenant_id = $1`,
    'delete from app.audit_entry where tenant_id = $1',
  ]) {
    const error = await refusal(ownerPool, null, statement, [tenant])
    expect(error, statement).toMatchObject({ ...insufficientPrivilege, message: 'app.audit_entry is append-only' })
  }
  expect(await refusal(ownerPool, null, 'truncate app.audit_entry')).toMatchObject({ ...insufficientPrivilege, message: 'app.audit_entry is append-only' })
  expect(await entriesOf(tenant)).toEqual(before)
})
