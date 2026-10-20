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
    ['settings.operational_day_start_changed', null, '{"from":5,"to":6,"email":"ana@example.test"}'],
    ['settings.operational_day_start_changed', subject, '{"from":5,"to":6}'],
    ['settings.operational_day_start_changed', null, '{"from":5,"to":9}'],
    ['settings.operational_day_start_changed', null, '{"from":-1,"to":5}'],
    ['settings.operational_day_start_changed', null, '{"from":5.5,"to":6}'],
    ['settings.transfer_duration_changed', null, '{"from":60,"to":90,"email":"ana@example.test"}'],
    ['settings.transfer_duration_changed', subject, '{"from":60,"to":90}'],
    ['settings.transfer_duration_changed', null, '{"from":0,"to":60}'],
    ['settings.relocation_gap_changed', null, '{"from":15,"to":1441}'],
    ['settings.relocation_gap_changed', null, '{"from":"15","to":20}'],
    ['client.created', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","kind":"agency","name":"Mora"}'],
    ['client.created', subject, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","kind":"agency"}'],
    ['client.name_changed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","from":"Mora","to":"Mora d.o.o."}'],
    ['client.kind_changed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","from":"hotel","to":"partner"}'],
    // A contact person records the Client id, the contact id, and field names. Never the name, the role, the phone, or the email.
    ['contact_person.added', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["name","phone"],"name":"Ana Booking"}'],
    ['contact_person.added', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["name","phone"],"phone":"+385911110364"}'],
    ['contact_person.added', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["name","email"],"email":"booking@example.test"}'],
    ['contact_person.added', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["name","role","phone"],"role":"booking"}'],
    ['contact_person.added', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["phone"]}'],
    ['contact_person.added', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["name"]}'],
    ['contact_person.added', subject, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["name","phone"]}'],
    ['contact_person.changed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["phone"],"phone":"+385911110364"}'],
    ['contact_person.changed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["removed"]}'],
    ['contact_person.removed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["name"]}'],
    ['contact_person.removed', null, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["removed"],"email":"booking@example.test"}'],
    ['contact_person.removed', subject, '{"clientId":"9e4b3f6d-5555-4555-8555-555555555555","contactPersonId":"8e4b3f6d-5555-4555-8555-555555555555","fields":["removed"]}'],
    // A Partner records the id and field names. Never the name, the phone, the email, or the note.
    ['partner.created', null, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777","fields":["name"],"name":"Mora Transfer"}'],
    ['partner.created', null, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777","fields":["name","phone"],"phone":"+385911110379"}'],
    ['partner.created', null, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777","fields":["name","email"],"email":"office@mora.example"}'],
    ['partner.changed', null, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777","fields":["note"],"note":"Call the desk."}'],
    ['partner.created', null, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777","fields":["phone"]}'],
    ['partner.changed', null, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777","fields":["email","name"]}'],
    ['partner.archived', null, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777","name":"Mora Transfer"}'],
    ['partner.restored', subject, '{"partnerId":"2e3d4c5b-7777-4777-8777-777777777777"}'],
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

it('append_entry accepts a ride marked done with the Ride id, the Driver id, and the field name state, and refuses an extra key', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  const valid = { rideId, driverId, fields: ['state'] }
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.done',
    actor,
    null,
    JSON.stringify(valid),
  ]))
  expect(await entriesOf(tenant)).toEqual([{
    tenant_id: tenant,
    action: 'ride.done',
    actor_user_id: actor,
    subject_user_id: null,
    data: valid,
  }])

  const extraKey = await refusal(appPool, tenant, append, [
    'ride.done',
    actor,
    null,
    JSON.stringify({ ...valid, guestName: 'Ana Anić' }),
  ])
  expect(extraKey).toMatchObject({ code: '23514' })
  expect(await entriesOf(tenant)).toHaveLength(1)
})

it('append_entry accepts a No-show and an early office No-show, and refuses a fee', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  const valid = { rideId, driverId, fields: ['state'] }
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.no_show',
    actor,
    null,
    JSON.stringify(valid),
  ]))
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.no_show_early',
    actor,
    null,
    JSON.stringify(valid),
  ]))
  const rows = await entriesOf(tenant)
  expect(rows.map(row => row.action).sort()).toEqual(['ride.no_show', 'ride.no_show_early'])
  for (const row of rows) {
    expect(row).toMatchObject({
      actor_user_id: actor,
      subject_user_id: null,
      data: valid,
    })
  }

  const extraKey = await refusal(appPool, tenant, append, [
    'ride.no_show',
    actor,
    null,
    JSON.stringify({ ...valid, fee: '10.00' }),
  ])
  expect(extraKey).toMatchObject({ code: '23514' })
  expect(await entriesOf(tenant)).toHaveLength(2)
})

it('append_entry accepts a cancelled Ride with a Driver id or null, and refuses an extra key', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  const withDriver = { rideId, driverId, fields: ['state'] }
  const unassigned = { rideId, driverId: null, fields: ['state'] }
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.cancelled',
    actor,
    null,
    JSON.stringify(withDriver),
  ]))
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.cancelled',
    actor,
    null,
    JSON.stringify(unassigned),
  ]))
  const stored = await entriesOf(tenant)
  expect(stored).toHaveLength(2)
  expect(stored).toEqual(expect.arrayContaining([
    {
      tenant_id: tenant,
      action: 'ride.cancelled',
      actor_user_id: actor,
      subject_user_id: null,
      data: withDriver,
    },
    {
      tenant_id: tenant,
      action: 'ride.cancelled',
      actor_user_id: actor,
      subject_user_id: null,
      data: unassigned,
    },
  ]))

  const extraKey = await refusal(appPool, tenant, append, [
    'ride.cancelled',
    actor,
    null,
    JSON.stringify({ ...unassigned, guestName: 'Ana Anić' }),
  ])
  expect(extraKey).toMatchObject({ code: '23514' })
  expect(await entriesOf(tenant)).toHaveLength(2)
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

it('append_entry accepts a landing time with a Driver id or null, and refuses the instant and an extra key', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  const withDriver = { rideId, driverId, fields: ['landingAt'] }
  const unassigned = { rideId, driverId: null, fields: ['landingAt'] }
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.landing_recorded',
    actor,
    null,
    JSON.stringify(withDriver),
  ]))
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.landing_recorded',
    actor,
    null,
    JSON.stringify(unassigned),
  ]))
  expect(await entriesOf(tenant)).toEqual(expect.arrayContaining([
    {
      tenant_id: tenant,
      action: 'ride.landing_recorded',
      actor_user_id: actor,
      subject_user_id: null,
      data: withDriver,
    },
    {
      tenant_id: tenant,
      action: 'ride.landing_recorded',
      actor_user_id: actor,
      subject_user_id: null,
      data: unassigned,
    },
  ]))

  const extraKey = await refusal(appPool, tenant, append, [
    'ride.landing_recorded',
    actor,
    null,
    JSON.stringify({ ...unassigned, landingAt: '2026-01-15T09:30:00.000Z' }),
  ])
  expect(extraKey).toMatchObject({ code: '23514' })
  expect(await entriesOf(tenant)).toHaveLength(2)
})

it('append_entry accepts a decline with the Ride id, the Driver id, the Vehicle id, and the assignment field names, and refuses an extra key', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const append = `select audit.append_entry($1, $2, $3, $4::jsonb)`
  const valid = { rideId, driverId, vehicleId, fields: ['state', 'driverId', 'vehicleId', 'mustAccept'] }
  await inSession(appPool, tenant, client => client.query(append, [
    'ride.declined',
    actor,
    null,
    JSON.stringify(valid),
  ]))
  expect(await entriesOf(tenant)).toEqual([{
    tenant_id: tenant,
    action: 'ride.declined',
    actor_user_id: actor,
    subject_user_id: null,
    data: valid,
  }])

  const extraKey = await refusal(appPool, tenant, append, [
    'ride.declined',
    actor,
    null,
    JSON.stringify({ ...valid, guestName: 'Ana Anić' }),
  ])
  expect(extraKey).toMatchObject({ code: '23514' })
  expect(await entriesOf(tenant)).toHaveLength(1)
})

it('append_entry accepts a contact person add, correction, and removal with ids and field names only', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
  const contactPersonId = '8e4b3f6d-5555-4555-8555-555555555555'
  const append = `select audit.append_entry($1, $2, null, $3::jsonb)`
  const added = { clientId, contactPersonId, fields: ['name', 'role', 'phone', 'email'] }
  const changed = { clientId, contactPersonId, fields: ['role'] }
  const removed = { clientId, contactPersonId, fields: ['removed'] }
  await inSession(appPool, tenant, client => client.query(append, ['contact_person.added', actor, JSON.stringify(added)]))
  await inSession(appPool, tenant, client => client.query(append, ['contact_person.changed', actor, JSON.stringify(changed)]))
  await inSession(appPool, tenant, client => client.query(append, ['contact_person.removed', actor, JSON.stringify(removed)]))
  // The three rows can share one timestamp, so the table read has no stable order.
  const rows = (await entriesOf(tenant)).sort((left, right) => left.action.localeCompare(right.action))
  expect(rows).toEqual([
    { tenant_id: tenant, action: 'contact_person.added', actor_user_id: actor, subject_user_id: null, data: added },
    { tenant_id: tenant, action: 'contact_person.changed', actor_user_id: actor, subject_user_id: null, data: changed },
    { tenant_id: tenant, action: 'contact_person.removed', actor_user_id: actor, subject_user_id: null, data: removed },
  ])
  const text = JSON.stringify(rows)
  expect(text).not.toContain('Ana Booking')
  expect(text).not.toContain('+385911110364')
  expect(text).not.toContain('booking@example.test')
})

it('append_entry accepts a Partner create, change, archive, and restore with the id and field names only', async () => {
  const tenant = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const partnerId = '2e3d4c5b-7777-4777-8777-777777777777'
  const append = `select audit.append_entry($1, $2, null, $3::jsonb)`
  const created = { partnerId, fields: ['name', 'phone', 'email', 'note'] }
  const changed = { partnerId, fields: ['note'] }
  const archived = { partnerId }
  const restored = { partnerId }
  await inSession(appPool, tenant, client => client.query(append, ['partner.created', actor, JSON.stringify(created)]))
  await inSession(appPool, tenant, client => client.query(append, ['partner.changed', actor, JSON.stringify(changed)]))
  await inSession(appPool, tenant, client => client.query(append, ['partner.archived', actor, JSON.stringify(archived)]))
  await inSession(appPool, tenant, client => client.query(append, ['partner.restored', actor, JSON.stringify(restored)]))
  const rows = (await entriesOf(tenant)).sort((left, right) => left.action.localeCompare(right.action))
  expect(rows).toEqual([
    { tenant_id: tenant, action: 'partner.archived', actor_user_id: actor, subject_user_id: null, data: archived },
    { tenant_id: tenant, action: 'partner.changed', actor_user_id: actor, subject_user_id: null, data: changed },
    { tenant_id: tenant, action: 'partner.created', actor_user_id: actor, subject_user_id: null, data: created },
    { tenant_id: tenant, action: 'partner.restored', actor_user_id: actor, subject_user_id: null, data: restored },
  ])
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
