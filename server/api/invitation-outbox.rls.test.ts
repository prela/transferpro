import type { TenantRole } from '../../shared'
import type { JobQueue } from '../core/index'
import type { OutboxSender } from '../modules/mail'
import type { InvitationMail } from '../modules/tenancy'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { failedMailResendSchema, inviteResultSchema, officeHomeSchema } from '../../shared'
import { configureLogger, openTenantSession } from '../core/index'
import { captureLogs } from '../core/testing'
import { handleMailOutboxJob, invitationMailOutbox } from '../modules/mail'
import { closeTenantRuntime, createTenant, handleAuthRequest, inviteMember, revokePendingInvitation } from '../modules/tenancy'
import { closeMailOutboxQueue, mailOutboxStore, resendFailedMail } from '../modules/transfers'
import invitePost from './invitations/index.post'
import getOfficeHome from './office-home.get'
import resendFailed from './office-home/failed-mail/[entryId]/resend.post'

/**
 * Invitations go through the mail outbox (ADR-0045). The invite route waits
 * for the first attempt and always returns the link. Retries compose from
 * the invitation each time. Home lists a failed, still-pending invitation to
 * the Admin only, by outbox entry id. The invitation id is a bearer secret:
 * not in a Home read, a resend response, or a log line.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const databaseUrl = required('DATABASE_URL')
const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const password = 'invitation-outbox-password'
const authUrl = required('BETTER_AUTH_URL')
const appPool = new pg.Pool({ connectionString: databaseUrl })
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appDb = drizzle(appPool)

configureLogger('info')

const app = createApp()
app.use('/api/invitations', (event) => {
  if (event.method === 'POST')
    return invitePost(event)
  return new Response('Not Found', { status: 404 })
})
app.use('/api/office-home', (event) => {
  // The mount strips `/api/office-home`, and this test app does not fill :param.
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '') || '/'
  const marker = '/failed-mail/'
  if (event.method === 'POST' && pathOnly.startsWith(marker) && pathOnly.endsWith('/resend')) {
    event.context.params = { entryId: decodeURIComponent(pathOnly.slice(marker.length, -'/resend'.length)) }
    return resendFailed(event)
  }
  if (event.method === 'GET' && pathOnly === '/')
    return getOfficeHome(event)
  return new Response('Not Found', { status: 404 })
})
const callApp = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  const tenants = `select id from auth.organization where slug like 'iout-%'`
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (${tenants})`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.invitation where organization_id in (${tenants})`)
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'iout-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'iout-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'iout-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'iout-%'`)
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
  await closeMailOutboxQueue()
  await closeTenantRuntime()
  await appPool.end()
  await authPool.end()
  await ownerPool.end()
})

async function tenant(slug: string) {
  return createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName: 'Hana Admin',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
}

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<void> {
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

interface EntryRow {
  id: string
  kind: string
  invitation_id: string | null
  ride_id: string | null
  state: string
  attempt_count: number
  next_attempt_at: Date | null
}

async function entriesFor(tenantId: string): Promise<EntryRow[]> {
  const result = await ownerPool.query<EntryRow>(
    `select id, kind, invitation_id, ride_id, state, attempt_count, next_attempt_at
     from app.mail_outbox where tenant_id = $1 order by created_at, id`,
    [tenantId],
  )
  return result.rows
}

async function entryFor(invitationId: string): Promise<EntryRow> {
  const result = await ownerPool.query<EntryRow>(
    `select id, kind, invitation_id, ride_id, state, attempt_count, next_attempt_at
     from app.mail_outbox where invitation_id = $1`,
    [invitationId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('entry missing')
  return row
}

async function auditCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

async function jobCount(entryId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from pgboss.job where data::text like $1`,
    [`%${entryId}%`],
  )
  return Number(result.rows[0]?.count)
}

async function markFailed(entryId: string): Promise<void> {
  await ownerPool.query(
    `update app.mail_outbox set state = 'failed', attempt_count = 4, next_attempt_at = null where id = $1`,
    [entryId],
  )
}

function invitationIdOf(inviteUrl: string): string {
  return new URL(inviteUrl).hash.slice(1)
}

function postInvite(session: Headers, body: unknown) {
  const headers = new Headers(session)
  headers.set('content-type', 'application/json')
  return callApp(new Request('http://localhost/api/invitations', { method: 'POST', headers, body: JSON.stringify(body) }))
}

function postResend(entryId: string, session?: Headers) {
  const headers = new Headers(session)
  headers.set('content-type', 'application/json')
  return callApp(new Request(`http://localhost/api/office-home/failed-mail/${entryId}/resend`, {
    method: 'POST',
    headers,
    body: '{}',
  }))
}

function getHome(session: Headers) {
  return callApp(new Request('http://localhost/api/office-home', { headers: session }))
}

/** A mailer that records each invitation and fails while `failing` is set. */
function recordingMailer(failing = false): OutboxSender & { invitations: InvitationMail[], fail: (on: boolean) => void } {
  const invitations: InvitationMail[] = []
  let failNow = failing
  return {
    invitations,
    fail(on) {
      failNow = on
    },
    async sendWorkOrder() {
      throw new Error('no work order in this file')
    },
    async sendInvitation(mail) {
      invitations.push({ ...mail })
      if (failNow)
        throw new Error(`Invitation email was not sent to ${mail.to}.`)
    },
  }
}

/** Records each retry the attempt queues. Nothing runs. */
function recordingQueue(): JobQueue & { enqueued: Date[] } {
  const enqueued: Date[] = []
  return {
    enqueued,
    async enqueue(_context, _transaction, _name, _data, options) {
      enqueued.push(options?.startAfter ?? new Date(0))
    },
    async handleNext() {
      return null
    },
    async schedule() {},
    async workScheduled() {},
    async work() {},
    async close() {},
  }
}

/** One due retry, as the worker runs it: the store picks the reader by kind. */
async function runRetry(tenantId: string, entryId: string, mailer: OutboxSender, queue: JobQueue, now: Date, log = captureLogs().logger) {
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId }, async () => {
      await handleMailOutboxJob({
        id: crypto.randomUUID(),
        name: 'mail-outbox',
        tenantId,
        data: { entryId },
      }, { transaction }, { mailer, queue, log, now: () => now, openStore: mailOutboxStore })
    })
  })
}

it('returns the link and writes one invitation entry when the first send fails, and keeps Better Auth\'s invite route closed', async () => {
  const created = await tenant('iout-http')
  const admin = await signIn('iout-http-admin@example.test')
  const audits = await auditCount(created.tenantId)

  const before = Date.now()
  const failedResponse = await postInvite(admin, { email: 'invite-fail@example.test', role: 'driver' })
  expect(failedResponse.status).toBe(200)
  const failed = inviteResultSchema.parse(await failedResponse.json())
  expect(failed.mail).toBe('retrying')
  const invitationId = invitationIdOf(failed.inviteUrl)
  expect(invitationId).toMatch(/^[0-9a-f-]{36}$/)

  const entry = await entryFor(invitationId)
  expect(entry).toMatchObject({ kind: 'invitation', ride_id: null, state: 'pending', attempt_count: 1 })
  // The job queued with the row is the next attempt, one minute after the write.
  const due = entry.next_attempt_at?.getTime() ?? 0
  expect(due).toBeGreaterThanOrEqual(before + 60_000 - 1000)
  expect(due).toBeLessThanOrEqual(Date.now() + 60_000 + 1000)
  expect(await jobCount(entry.id)).toBe(1)

  const sentResponse = await postInvite(admin, { email: 'iout-http-sent@example.test', role: 'dispatcher' })
  const sent = inviteResultSchema.parse(await sentResponse.json())
  expect(sent.mail).toBe('sent')
  expect(await entryFor(invitationIdOf(sent.inviteUrl))).toMatchObject({ state: 'sent', attempt_count: 1, next_attempt_at: null })
  expect((await entriesFor(created.tenantId)).map(row => row.kind)).toEqual(['invitation', 'invitation'])

  // Creating the invitation is audited once each. The mail is not.
  expect(await auditCount(created.tenantId)).toBe(audits + 2)

  const sideDoor = await handleAuthRequest(new Request(new URL('/api/auth/organization/invite-member', authUrl), {
    method: 'POST',
    headers: { 'cookie': admin.get('cookie') ?? '', 'origin': authUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'iout-http-side@example.test', role: 'driver', organizationId: created.tenantId }),
  }))
  expect(sideDoor.status).toBe(404)
})

it('refuses a dispatcher and a driver before any invitation or entry is written', async () => {
  const created = await tenant('iout-refuse')
  await addMember(created.tenantId, 'iout-refuse-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'iout-refuse-driver@example.test', 'Drago Driver', 'driver')
  for (const email of ['iout-refuse-dispatcher@example.test', 'iout-refuse-driver@example.test']) {
    const response = await postInvite(await signIn(email), { email: 'iout-refuse-nope@example.test', role: 'driver' })
    expect(response.status).toBe(403)
  }
  expect(await entriesFor(created.tenantId)).toEqual([])
})

it('composes at each attempt from the invitation, the Tenant name, and the Tenant default locale, and retries as a work order does', async () => {
  const created = await tenant('iout-compose')
  const admin = await signIn('iout-compose-admin@example.test')
  await ownerPool.query(`update app.tenant_settings set default_locale = 'en' where tenant_id = $1`, [created.tenantId])
  const mailer = recordingMailer(true)
  const logs = captureLogs()
  const result = await inviteMember(admin, { email: 'IOUT-Compose-Invitee@example.test', role: 'dispatcher' }, invitationMailOutbox({ mailer, log: logs.logger }))
  expect(result.mail).toBe('retrying')
  const invitationId = invitationIdOf(result.inviteUrl)
  const entry = await entryFor(invitationId)
  expect(mailer.invitations).toHaveLength(1)
  expect(mailer.invitations[0]).toMatchObject({
    to: 'iout-compose-invitee@example.test',
    inviteUrl: result.inviteUrl,
    role: 'dispatcher',
    tenantName: 'Tenant iout-compose',
    locale: 'en',
  })
  const firstKey = mailer.invitations[0]?.idempotencyKey ?? ''
  expect(firstKey.startsWith(`${entry.id}.`)).toBe(true)
  expect(firstKey).not.toContain(invitationId)

  // The locale changed after the first attempt. The retry reads it again.
  await ownerPool.query(`update app.tenant_settings set default_locale = 'hr' where tenant_id = $1`, [created.tenantId])
  const queue = recordingQueue()
  const start = Date.now()
  await runRetry(created.tenantId, entry.id, mailer, queue, new Date(start + 2 * 60_000), logs.logger)
  expect(mailer.invitations[1]).toMatchObject({ locale: 'hr', role: 'dispatcher', inviteUrl: result.inviteUrl })
  expect(mailer.invitations[1]?.idempotencyKey).not.toBe(firstKey)
  expect(await entryFor(invitationId)).toMatchObject({ state: 'pending', attempt_count: 2 })
  expect(queue.enqueued.map(at => at.getTime() - (start + 2 * 60_000))).toEqual([300_000])

  await runRetry(created.tenantId, entry.id, mailer, queue, new Date(start + 8 * 60_000), logs.logger)
  expect(await entryFor(invitationId)).toMatchObject({ state: 'pending', attempt_count: 3 })
  expect(queue.enqueued.at(-1)?.getTime()).toBe(start + 8 * 60_000 + 1_800_000)

  await runRetry(created.tenantId, entry.id, mailer, queue, new Date(start + 40 * 60_000), logs.logger)
  expect(await entryFor(invitationId)).toMatchObject({ state: 'failed', attempt_count: 4, next_attempt_at: null })
  expect(queue.enqueued).toHaveLength(2)
  expect(mailer.invitations).toHaveLength(4)

  const lines = JSON.stringify(logs.lines())
  expect(lines).not.toContain(invitationId)
  expect(lines.toLowerCase()).not.toContain('iout-compose-invitee')
})

it('sends a pending invitation and makes an accepted, revoked, or expired one stale without sending', async () => {
  const created = await tenant('iout-current')
  const admin = await signIn('iout-current-admin@example.test')
  const mailer = recordingMailer(true)
  const outbox = invitationMailOutbox({ mailer, log: captureLogs().logger })
  const invite = async (email: string) => {
    const result = await inviteMember(admin, { email, role: 'driver' }, outbox)
    const invitationId = invitationIdOf(result.inviteUrl)
    return { invitationId, entryId: (await entryFor(invitationId)).id }
  }
  const pending = await invite('iout-current-pending@example.test')
  const accepted = await invite('iout-current-accepted@example.test')
  const revoked = await invite('iout-current-revoked@example.test')
  const expired = await invite('iout-current-expired@example.test')

  await authPool.query(`update auth.invitation set status = 'accepted' where id = $1`, [accepted.invitationId])
  await revokePendingInvitation(admin, revoked.invitationId)
  await authPool.query(`update auth.invitation set expires_at = now() - interval '1 minute' where id = $1`, [expired.invitationId])

  mailer.fail(false)
  const sentBefore = mailer.invitations.length
  const later = new Date(Date.now() + 2 * 60_000)
  for (const entry of [pending, accepted, revoked, expired])
    await runRetry(created.tenantId, entry.entryId, mailer, recordingQueue(), later)

  expect(mailer.invitations.slice(sentBefore).map(mail => mail.to)).toEqual(['iout-current-pending@example.test'])
  expect((await entryFor(pending.invitationId)).state).toBe('sent')
  for (const entry of [accepted, revoked, expired])
    expect(await entryFor(entry.invitationId)).toMatchObject({ state: 'stale', attempt_count: 1, next_attempt_at: null })
})

it('lets only the Admin see and resend a failed pending invitation, refuses a dispatcher with 403 and another Tenant with 404, and audits nothing', async () => {
  const created = await tenant('iout-home')
  await addMember(created.tenantId, 'iout-home-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'iout-home-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('iout-home-admin@example.test')
  const dispatcher = await signIn('iout-home-dispatcher@example.test')
  const driver = await signIn('iout-home-driver@example.test')
  await tenant('iout-home-other')
  const outsider = await signIn('iout-home-other-admin@example.test')
  const outbox = invitationMailOutbox({ mailer: recordingMailer(true), log: captureLogs().logger })

  const invitee = 'iout-home-invitee@example.test'
  const result = await inviteMember(admin, { email: invitee, role: 'dispatcher' }, outbox)
  const invitationId = invitationIdOf(result.inviteUrl)
  const entry = await entryFor(invitationId)
  await markFailed(entry.id)
  const acceptedResult = await inviteMember(admin, { email: 'iout-home-gone@example.test', role: 'driver' }, outbox)
  const acceptedId = invitationIdOf(acceptedResult.inviteUrl)
  const acceptedEntry = await entryFor(acceptedId)
  await markFailed(acceptedEntry.id)
  await authPool.query(`update auth.invitation set status = 'accepted' where id = $1`, [acceptedId])
  const audits = await auditCount(created.tenantId)

  const adminHomeResponse = await getHome(admin)
  expect(adminHomeResponse.status).toBe(200)
  const adminHomeText = await adminHomeResponse.text()
  const adminHome = officeHomeSchema.parse(JSON.parse(adminHomeText))
  expect(adminHome.failedMails).toEqual([{ kind: 'invitation', entryId: entry.id, email: invitee, role: 'dispatcher' }])
  expect(adminHomeText).not.toContain(invitationId)
  expect(adminHomeText).not.toContain(acceptedId)

  const dispatcherHomeText = await (await getHome(dispatcher)).text()
  expect(officeHomeSchema.parse(JSON.parse(dispatcherHomeText)).failedMails).toEqual([])
  expect(dispatcherHomeText).not.toContain(invitee)
  expect((await getHome(driver)).status).toBe(403)
  expect(officeHomeSchema.parse(await (await getHome(outsider)).json()).failedMails).toEqual([])

  expect((await postResend(entry.id, dispatcher)).status).toBe(403)
  expect((await postResend(entry.id, driver)).status).toBe(403)
  expect((await postResend(entry.id, outsider)).status).toBe(404)
  expect((await postResend(entry.id)).status).toBe(401)
  expect(await entryFor(invitationId)).toMatchObject({ state: 'failed', attempt_count: 4 })

  const resent = await postResend(entry.id, admin)
  expect(resent.status).toBe(200)
  const resentText = await resent.text()
  expect(failedMailResendSchema.parse(JSON.parse(resentText))).toEqual({ outcome: 'sent' })
  expect(resentText).not.toContain(invitationId)
  expect(resentText).not.toContain(invitee)
  expect(await entryFor(invitationId)).toMatchObject({ state: 'sent', attempt_count: 4 })
  expect((await postResend(entry.id, admin)).status).toBe(404)

  const stale = failedMailResendSchema.parse(await (await postResend(acceptedEntry.id, admin)).json())
  expect(stale).toEqual({ outcome: 'stale' })
  expect(await entryFor(acceptedId)).toMatchObject({ state: 'stale', attempt_count: 4 })

  expect(officeHomeSchema.parse(await (await getHome(admin)).json()).failedMails).toEqual([])
  expect(await auditCount(created.tenantId)).toBe(audits)
})

it('keeps the email and the invitation id out of every log line, and still returns the link when the entry cannot be written', async () => {
  const created = await tenant('iout-logs')
  const admin = await signIn('iout-logs-admin@example.test')
  const logs = captureLogs()
  const mailer = recordingMailer(true)

  const failed = await inviteMember(admin, { email: 'iout-logs-failed@example.test', role: 'driver' }, invitationMailOutbox({ mailer, log: logs.logger }))
  const failedId = invitationIdOf(failed.inviteUrl)
  const failedEntry = await entryFor(failedId)
  await markFailed(failedEntry.id)
  mailer.fail(false)
  const resent = await resendFailedMail(admin, failedEntry.id, {}, mailer, logs.logger)
  expect(resent).toEqual({ outcome: 'sent' })

  const brokenQueue: JobQueue = {
    ...recordingQueue(),
    async enqueue() {
      throw new Error('queue is down')
    },
  }
  const lost = await inviteMember(admin, { email: 'iout-logs-lost@example.test', role: 'driver' }, invitationMailOutbox({ mailer, log: logs.logger, queue: brokenQueue }))
  expect(lost.mail).toBe('not_sent')
  const lostId = invitationIdOf(lost.inviteUrl)
  // The entry and its job share one transaction. Neither is left behind.
  expect((await entriesFor(created.tenantId)).map(row => row.invitation_id)).toEqual([failedId])

  const lines = logs.lines()
  expect(lines.map(line => line.event)).toEqual(expect.arrayContaining([
    'mail_outbox.attempt',
    'mail_outbox.resend',
    'mail_outbox.invitation_not_recorded',
  ]))
  const text = JSON.stringify(lines)
  for (const secret of [failedId, lostId, 'iout-logs-failed@example.test', 'iout-logs-lost@example.test', 'example.test'])
    expect(text).not.toContain(secret)
})

it('returns the link with a not-sent mail when the mail port throws before it can decide', async () => {
  await tenant('iout-port')
  const admin = await signIn('iout-port-admin@example.test')
  const warn = vi.spyOn(configureLogger('info'), 'warn')
  try {
    const result = await inviteMember(admin, { email: 'iout-port-invitee@example.test', role: 'driver' }, {
      async deliver() {
        throw new Error('Logger is not configured.')
      },
    })
    expect(result.mail).toBe('not_sent')
    expect(new URL(result.inviteUrl).hash).toMatch(/^#[0-9a-f-]{36}$/)
    expect(warn).toHaveBeenCalledWith({ event: 'invite.mail_not_recorded' })
    const text = JSON.stringify(warn.mock.calls)
    expect(text).not.toContain(new URL(result.inviteUrl).hash.slice(1))
    expect(text).not.toContain('iout-port-invitee')
  }
  finally {
    warn.mockRestore()
  }
})
