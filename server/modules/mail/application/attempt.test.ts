import type { JobQueue, QueuedJob, TenantTransaction } from '../../../core/index'
import type { InvitationMail } from '../../tenancy'
import type { LoadedInvitationEntry, LoadedOutboxEntry, LoadedWorkOrderEntry, OutboxAttemptPatch } from './attempt'
import { expect, it } from 'vitest'
import { runWithRequestId } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { ResendTransportError } from '../../tenancy'
import { firstOutboxAttempt, handleMailOutboxJob, MAIL_OUTBOX_QUEUE, OutboxComposeError } from './attempt'

const tenantId = '33333333-3333-4333-8333-333333333333'
const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'
const otherEntryId = 'd2d2d2d2-2222-4222-8222-222222222222'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const email = 'ana@example.test'
const guest = 'Ana Tajna'
const started = new Date('2026-10-18T10:00:00.000Z')

const message = {
  subject: 'Dodijeljeno',
  text: `Gost: ${guest}`,
  html: `<p>Gost: ${guest}</p>`,
}

function entry(overrides: Partial<LoadedWorkOrderEntry> = {}): LoadedWorkOrderEntry {
  return {
    kind: 'work_order',
    entryId,
    status: 'assigned',
    driverId,
    rideFinished: false,
    rideCancelled: false,
    superseded: false,
    email,
    state: 'pending',
    attemptCount: 0,
    nextAttemptAt: started,
    message,
    ...overrides,
  }
}

/**
 * The service seam: a fake clock, the fake-shaped mailer, and `handleNext`.
 * Jobs wait until `startAfter`. Nothing here talks to Postgres or Resend.
 */
function harness(initial: LoadedOutboxEntry[]) {
  let now = started
  const entries = new Map(initial.map(row => [row.entryId, { ...row }]))
  const jobs: Array<{ id: string, name: string, tenantId: string, data: unknown, startAfter: Date }> = []
  const sent: Array<{ to: string, subject: string, text: string, html: string, idempotencyKey?: string }> = []
  const invited: InvitationMail[] = []
  let rejectSend = false
  let composeFails = false
  let unreadable = false
  const logs = captureLogs()

  const queue = {
    async enqueue(context, _transaction, name, data, options) {
      jobs.push({
        id: crypto.randomUUID(),
        name,
        tenantId: context.tenantId,
        data,
        startAfter: options?.startAfter ?? now,
      })
    },
    async handleNext(name, handle) {
      const index = jobs.findIndex(job => job.name === name && job.startAfter.getTime() <= now.getTime())
      if (index < 0)
        return null
      const job = jobs.splice(index, 1)[0]
      if (!job)
        return null
      const queued: QueuedJob = { id: job.id, name: job.name, tenantId: job.tenantId, data: job.data }
      await handle(queued, { transaction: {} as TenantTransaction })
      return queued
    },
    async schedule() {},
    async workScheduled() {},
    async work() {},
    async close() {},
  } as JobQueue

  async function due(name = MAIL_OUTBOX_QUEUE) {
    return queue.handleNext(name, async (job, scope) => {
      await handleMailOutboxJob(job, scope, {
        mailer: {
          async sendWorkOrder(mail) {
            sent.push(mail)
            if (rejectSend)
              throw new Error('Work order email was not sent.')
          },
          async sendInvitation(mail) {
            invited.push(mail)
            if (rejectSend)
              throw new Error('Invitation email was not sent.')
          },
        },
        queue,
        log: logs.logger,
        now: () => now,
        openStore: () => ({
          async load(id) {
            if (unreadable)
              throw new Error(`db ${email} ${guest}`)
            const row = entries.get(id)
            if (!row)
              return null
            if (composeFails)
              throw new OutboxComposeError({ ...row, message: null })
            return { ...row, message: row.message ? { ...row.message } : null }
          },
          async save(id, patch: OutboxAttemptPatch) {
            const row = entries.get(id)
            if (!row || row.state !== 'pending')
              throw new Error('Mail outbox update failed')
            entries.set(id, { ...row, ...patch })
          },
        }),
      })
    })
  }

  return {
    sent,
    invited,
    logs,
    jobs,
    entries,
    queue,
    due,
    failSends() {
      rejectSend = true
    },
    failCompose() {
      composeFails = true
    },
    failLoad() {
      unreadable = true
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms)
    },
    enqueue(id: string, startAfter: Date) {
      return queue.enqueue({ tenantId }, {} as TenantTransaction, MAIL_OUTBOX_QUEUE, { entryId: id }, { startAfter })
    },
  }
}

it('sends at most four times, waiting 1, 5, and 30 minutes after each failure', async () => {
  const world = harness([entry({ nextAttemptAt: new Date(started.getTime() + 60_000) })])
  world.failSends()
  await world.enqueue(entryId, new Date(started.getTime() + 60_000))

  expect(await world.due()).toBeNull()
  expect(world.sent).toHaveLength(0)

  world.advance(60_000)
  expect(await world.due()).not.toBeNull()
  world.advance(60_000)
  expect(await world.due()).not.toBeNull()
  world.advance(300_000)
  expect(await world.due()).not.toBeNull()
  world.advance(1_800_000)
  expect(await world.due()).not.toBeNull()

  expect(world.sent).toHaveLength(4)
  expect(world.entries.get(entryId)).toMatchObject({ state: 'failed', attemptCount: 4, nextAttemptAt: null })
  expect(world.jobs).toHaveLength(0)
  expect(await world.due()).toBeNull()
})

it('stops after a successful attempt', async () => {
  const world = harness([entry()])
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  expect(world.sent).toHaveLength(1)
  expect(world.entries.get(entryId)).toMatchObject({ state: 'sent', attemptCount: 1, nextAttemptAt: null })
  expect(world.jobs).toHaveLength(0)
  expect(await world.due()).toBeNull()
})

it('marks a mail stale and sends nothing when the Ride is finished or a newer work order replaced it', async () => {
  const finished = harness([entry({ rideFinished: true })])
  await finished.enqueue(entryId, started)
  expect(await finished.due()).not.toBeNull()
  expect(finished.sent).toHaveLength(0)
  expect(finished.entries.get(entryId)).toMatchObject({ state: 'stale', attemptCount: 0 })
  expect(finished.jobs).toHaveLength(0)

  const replaced = harness([entry({ superseded: true, rideCancelled: true, status: 'cancelled' })])
  await replaced.enqueue(entryId, started)
  expect(await replaced.due()).not.toBeNull()
  expect(replaced.sent).toHaveLength(0)
  expect(replaced.entries.get(entryId)?.state).toBe('stale')
})

it('still sends the cancellation notice, and sends after the pickup when nothing replaced the entry', async () => {
  const world = harness([entry({ status: 'cancelled', rideCancelled: true })])
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  expect(world.sent).toHaveLength(1)
  expect(world.entries.get(entryId)?.state).toBe('sent')
})

it('sends the newer work order and does not send the one it replaced', async () => {
  const world = harness([
    entry({ superseded: true }),
    entry({ entryId: otherEntryId, status: 'changed', message: { ...message, subject: 'Promijenjeno' } }),
  ])
  await world.enqueue(entryId, started)
  await world.enqueue(otherEntryId, started)
  expect(await world.due()).not.toBeNull()
  expect(await world.due()).not.toBeNull()
  expect(world.sent.map(mail => mail.subject)).toEqual(['Promijenjeno'])
  expect(world.entries.get(entryId)?.state).toBe('stale')
  expect(world.entries.get(otherEntryId)?.state).toBe('sent')
})

const driverA = 'a1a1a1a1-1111-4111-8111-111111111111'
const driverB = 'b2b2b2b2-2222-4222-8222-222222222222'

it('keeps A no longer yours pending and sends it when only B gets a later vehicle change', async () => {
  const aLost = 'd3d3d3d3-3333-4333-8333-333333333333'
  const world = harness([
    entry({
      entryId: aLost,
      driverId: driverA,
      status: 'no_longer_yours',
      superseded: false,
      message: { ...message, subject: 'Više nije vaše' },
    }),
    entry({
      driverId: driverB,
      status: 'changed',
      superseded: false,
      message: { ...message, subject: 'Promijenjeno' },
    }),
  ])
  await world.enqueue(aLost, started)
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  expect(await world.due()).not.toBeNull()
  expect(world.sent.map(mail => mail.subject)).toEqual(['Više nije vaše', 'Promijenjeno'])
  expect(world.entries.get(aLost)).toMatchObject({ state: 'sent', attemptCount: 1 })
})

it('stales B assigned when B later receives changed', async () => {
  const world = harness([
    entry({ driverId: driverB, superseded: true, message: { ...message, subject: 'Dodijeljeno' } }),
    entry({
      entryId: otherEntryId,
      driverId: driverB,
      status: 'changed',
      superseded: false,
      message: { ...message, subject: 'Promijenjeno' },
    }),
  ])
  await world.enqueue(entryId, started)
  await world.enqueue(otherEntryId, started)
  expect(await world.due()).not.toBeNull()
  expect(await world.due()).not.toBeNull()
  expect(world.sent.map(mail => mail.subject)).toEqual(['Promijenjeno'])
  expect(world.entries.get(entryId)?.state).toBe('stale')
  expect(world.entries.get(otherEntryId)?.state).toBe('sent')
})

it('stales A no longer yours when A is assigned the Ride again', async () => {
  const world = harness([
    entry({ driverId: driverA, status: 'no_longer_yours', superseded: true }),
  ])
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  expect(world.sent).toHaveLength(0)
  expect(world.entries.get(entryId)).toMatchObject({ state: 'stale', attemptCount: 0 })
})

it('still sends A no longer yours after that send failed and the Ride was then cancelled', async () => {
  const world = harness([
    entry({
      driverId: driverA,
      status: 'no_longer_yours',
      rideCancelled: true,
      superseded: false,
      attemptCount: 1,
      message: { ...message, subject: 'Više nije vaše' },
    }),
  ])
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  expect(world.sent.map(mail => mail.subject)).toEqual(['Više nije vaše'])
  expect(world.entries.get(entryId)).toMatchObject({ state: 'sent', attemptCount: 2 })
})

it('counts a compose failure as an attempt and queues the next job', async () => {
  const world = harness([entry()])
  world.failCompose()
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  expect(world.sent).toHaveLength(0)
  expect(world.entries.get(entryId)).toMatchObject({ state: 'pending', attemptCount: 1 })
  expect(world.jobs).toHaveLength(1)
  expect(world.jobs[0]?.startAfter).toEqual(new Date(started.getTime() + 60_000))
})

it('logs only the entry id and lets the job retry when the row cannot be read', async () => {
  const world = harness([entry()])
  world.failLoad()
  await world.enqueue(entryId, started)
  await expect(world.due()).rejects.toThrow(`db ${email}`)
  expect(world.entries.get(entryId)).toMatchObject({ state: 'pending', attemptCount: 0 })
  const [line] = world.logs.lines()
  const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest } = line ?? {}
  expect(rest).toEqual({ event: 'mail_outbox.attempt_failed', entryId })
  expect(JSON.stringify(line)).not.toContain(email)
  expect(JSON.stringify(line)).not.toContain(guest)
})

it('counts a blank address found at a later attempt as a failure and does not send', async () => {
  const world = harness([entry({ attemptCount: 1, email: '   ' })])
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  expect(world.sent).toHaveLength(0)
  expect(world.entries.get(entryId)).toMatchObject({ state: 'pending', attemptCount: 2 })
  expect(world.jobs).toHaveLength(1)
  expect(world.jobs[0]?.startAfter).toEqual(new Date(started.getTime() + 300_000))
})

it('uses a new idempotency key when the composed message changes', async () => {
  const world = harness([entry()])
  world.failSends()
  await world.enqueue(entryId, started)
  expect(await world.due()).not.toBeNull()
  const first = world.sent[0]?.idempotencyKey
  const row = world.entries.get(entryId)
  if (!row)
    throw new Error('missing entry')
  world.entries.set(entryId, {
    ...row,
    message: { ...message, text: 'Gost: Marko' },
  })
  world.advance(60_000)
  expect(await world.due()).not.toBeNull()
  expect(world.sent[1]?.idempotencyKey).toBeTruthy()
  expect(world.sent[1]?.idempotencyKey).not.toBe(first)
  expect(world.sent[0]?.idempotencyKey).toContain(entryId)
})

it('logs the entry id and the restored request id, and nothing about the person', async () => {
  const world = harness([entry()])
  const requestId = '6b1e0c3a-2222-4222-8222-222222222222'
  await world.enqueue(entryId, started)
  await runWithRequestId(requestId, () => world.due())
  const [line] = world.logs.lines()
  const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest } = line ?? {}
  expect(rest).toEqual({ event: 'mail_outbox.attempt', entryId, request_id: requestId })
  expect(JSON.stringify(line)).not.toContain(email)
  expect(JSON.stringify(line)).not.toContain(guest)
})

it('still aborts when the Resend transport is selected in test', async () => {
  const world = harness([entry()])
  await world.enqueue(entryId, started)
  await expect(queueHandleWithTransport(world)).rejects.toBeInstanceOf(ResendTransportError)
  expect(world.entries.get(entryId)?.state).toBe('pending')
  expect(world.entries.get(entryId)?.attemptCount).toBe(0)
})

async function queueHandleWithTransport(world: ReturnType<typeof harness>) {
  await world.queue.handleNext(MAIL_OUTBOX_QUEUE, async (job, scope) => {
    await handleMailOutboxJob(job, scope, {
      mailer: {
        async sendWorkOrder() {
          throw new ResendTransportError()
        },
        async sendInvitation() {
          throw new ResendTransportError()
        },
      },
      queue: world.queue,
      log: world.logs.logger,
      now: () => started,
      openStore: () => ({
        async load(id) {
          const row = world.entries.get(id)
          return row ?? null
        },
        async save() {
          throw new Error('a refused transport must not settle the entry')
        },
      }),
    })
  })
}

const inviteEntryId = 'e1e1e1e1-1111-4111-8111-111111111111'
const invitee = 'pozvana@example.test'
const inviteUrl = 'http://localhost:3000/accept-invite#6b1e0c3a-4444-4444-8444-444444444444'
const inviteMessage = {
  subject: 'Pozivnica u Tvrtka',
  text: `Pozvani ste u Tvrtka kao vozač.\n${inviteUrl}`,
  html: `<p><a href="${inviteUrl}">Otvorite poveznicu</a></p>`,
}

function invitation(overrides: Partial<LoadedInvitationEntry> = {}): LoadedInvitationEntry {
  return {
    kind: 'invitation',
    entryId: inviteEntryId,
    invitation: { status: 'pending', expiresAt: new Date(started.getTime() + 7 * 24 * 60 * 60 * 1000) },
    mail: { to: invitee, inviteUrl, role: 'driver', tenantName: 'Tvrtka', locale: 'hr' },
    message: inviteMessage,
    state: 'pending',
    attemptCount: 0,
    nextAttemptAt: started,
    ...overrides,
  }
}

it('retries a failed invitation like a work order and keys it on the entry and the composed mail', async () => {
  const world = harness([invitation({ attemptCount: 1, nextAttemptAt: started })])
  world.failSends()
  await world.enqueue(inviteEntryId, started)
  expect(await world.due()).not.toBeNull()
  world.advance(300_000)
  expect(await world.due()).not.toBeNull()
  world.advance(1_800_000)
  expect(await world.due()).not.toBeNull()

  expect(world.invited).toHaveLength(3)
  expect(world.sent).toHaveLength(0)
  expect(world.invited[0]).toMatchObject({ to: invitee, role: 'driver', tenantName: 'Tvrtka', locale: 'hr' })
  const key = world.invited[0]?.idempotencyKey ?? ''
  expect(key.startsWith(`${inviteEntryId}.`)).toBe(true)
  expect(key).not.toContain('6b1e0c3a-4444-4444-8444-444444444444')
  expect(world.entries.get(inviteEntryId)).toMatchObject({ state: 'failed', attemptCount: 4, nextAttemptAt: null })
  expect(world.jobs).toHaveLength(0)
})

it('marks an invitation stale and sends nothing once it is accepted, revoked, expired, or gone', async () => {
  for (const facts of [
    { status: 'accepted', expiresAt: new Date(started.getTime() + 60_000) },
    { status: 'canceled', expiresAt: new Date(started.getTime() + 60_000) },
    { status: 'pending', expiresAt: started },
    null,
  ]) {
    const world = harness([invitation({ invitation: facts })])
    await world.enqueue(inviteEntryId, started)
    expect(await world.due()).not.toBeNull()
    expect(world.invited).toHaveLength(0)
    expect(world.entries.get(inviteEntryId)).toMatchObject({ state: 'stale', attemptCount: 0, nextAttemptAt: null })
    expect(world.jobs).toHaveLength(0)
  }
})

it('counts an invitation that cannot be composed as a failed attempt', async () => {
  const world = harness([invitation({ mail: null, message: null })])
  await world.enqueue(inviteEntryId, started)
  expect(await world.due()).not.toBeNull()
  expect(world.invited).toHaveLength(0)
  expect(world.entries.get(inviteEntryId)).toMatchObject({ state: 'pending', attemptCount: 1 })
  expect(world.jobs).toHaveLength(1)
})

/** The first attempt reads and settles one row. It never queues: the entry's own job is the retry. */
function firstStore(initial: LoadedOutboxEntry | null) {
  let row = initial
  return {
    row: () => row,
    store: {
      async load() {
        return row
      },
      async save(_id: string, patch: OutboxAttemptPatch) {
        if (!row)
          throw new Error('missing entry')
        row = { ...row, ...patch }
      },
    },
  }
}

it('sends a new invitation on the first attempt and marks it sent', async () => {
  const logs = captureLogs()
  const invited: InvitationMail[] = []
  const world = firstStore(invitation({ nextAttemptAt: new Date(started.getTime() + 60_000) }))
  const outcome = await firstOutboxAttempt({
    entryId: inviteEntryId,
    store: world.store,
    mailer: {
      async sendWorkOrder() {},
      async sendInvitation(mail) {
        invited.push(mail)
      },
    },
    now: started,
    log: logs.logger,
  })
  expect(outcome).toBe('sent')
  expect(invited).toHaveLength(1)
  expect(world.row()).toMatchObject({ state: 'sent', attemptCount: 1, nextAttemptAt: null })
  const text = JSON.stringify(logs.lines())
  expect(text).not.toContain(invitee)
  expect(text).not.toContain('6b1e0c3a-4444-4444-8444-444444444444')
})

it('keeps a failed first attempt pending with the queued time, so the queued job is the retry', async () => {
  const backup = new Date(started.getTime() + 60_000)
  const world = firstStore(invitation({ nextAttemptAt: backup }))
  const outcome = await firstOutboxAttempt({
    entryId: inviteEntryId,
    store: world.store,
    mailer: {
      async sendWorkOrder() {},
      async sendInvitation() {
        throw new Error(`provider down ${invitee}`)
      },
    },
    now: started,
    log: captureLogs().logger,
  })
  expect(outcome).toBe('pending')
  expect(world.row()).toMatchObject({ state: 'pending', attemptCount: 1, nextAttemptAt: backup })
})

it('does not send a first attempt that is no longer current, and reports a row the job already settled', async () => {
  const stale = firstStore(invitation({ invitation: { status: 'canceled', expiresAt: new Date(started.getTime() + 60_000) } }))
  const mailer = {
    async sendWorkOrder() {
      throw new Error('nothing may be sent')
    },
    async sendInvitation() {
      throw new Error('nothing may be sent')
    },
  }
  expect(await firstOutboxAttempt({ entryId: inviteEntryId, store: stale.store, mailer, now: started, log: captureLogs().logger })).toBe('stale')
  expect(stale.row()).toMatchObject({ state: 'stale', attemptCount: 0, nextAttemptAt: null })

  const done = firstStore(invitation({ state: 'sent', attemptCount: 1 }))
  expect(await firstOutboxAttempt({ entryId: inviteEntryId, store: done.store, mailer, now: started, log: captureLogs().logger })).toBe('sent')
  await expect(firstOutboxAttempt({
    entryId: inviteEntryId,
    store: firstStore(null).store,
    mailer,
    now: started,
    log: captureLogs().logger,
  })).rejects.toThrow('Mail outbox read failed')
})
