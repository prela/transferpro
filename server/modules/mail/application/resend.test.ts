import type { LoadedOutboxEntry } from './attempt'
import { expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { ResendTransportError } from '../../tenancy'
import { OutboxComposeError } from './attempt'
import { resendFailedWorkOrder } from './resend'

const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const email = 'ana@example.test'
const guest = 'Ana Tajna'

const message = {
  subject: 'Dodijeljeno',
  text: `Gost: ${guest}`,
  html: `<p>Gost: ${guest}</p>`,
}

function failed(overrides: Partial<LoadedOutboxEntry> = {}): LoadedOutboxEntry {
  return {
    entryId,
    status: 'assigned',
    driverId,
    rideFinished: false,
    rideCancelled: false,
    superseded: false,
    email,
    state: 'failed',
    attemptCount: 4,
    nextAttemptAt: null,
    message,
    ...overrides,
  }
}

/**
 * The resend seam: one failed row, a fake mailer, no queue.
 * A new retry cycle would need a job. This store has nowhere to put one.
 */
function harness(initial: LoadedOutboxEntry | null) {
  let row = initial ? { ...initial } : null
  const sent: Array<{ to: string, subject: string, idempotencyKey?: string }> = []
  let rejectSend = false
  let composeFails = false
  const settled: Array<'sent' | 'stale'> = []
  const logs = captureLogs()

  return {
    sent,
    settled,
    logs,
    row: () => row,
    failSend() {
      rejectSend = true
    },
    failCompose() {
      composeFails = true
    },
    async resend() {
      return resendFailedWorkOrder({
        entryId,
        log: logs.logger,
        mailer: {
          async sendWorkOrder(mail) {
            sent.push(mail)
            if (rejectSend)
              throw new Error(`Work order email was not sent to ${email}.`)
          },
        },
        store: {
          async load(id) {
            if (!row || row.entryId !== id)
              return null
            if (composeFails)
              throw new OutboxComposeError({ ...row, message: null })
            return { ...row, message: row.message ? { ...row.message } : null }
          },
          async settle(id, state) {
            if (!row || row.entryId !== id || row.state !== 'failed')
              throw new Error('Mail outbox update failed')
            row = { ...row, state, nextAttemptAt: null }
            settled.push(state)
          },
        },
      })
    },
  }
}

function logged(world: ReturnType<typeof harness>) {
  const [line] = world.logs.lines()
  const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest } = line ?? {}
  return { line, rest }
}

it('sends a failed work order once, marks it sent, and does not change the attempt count', async () => {
  const world = harness(failed())
  await expect(world.resend()).resolves.toBe('sent')
  expect(world.sent.map(mail => mail.subject)).toEqual(['Dodijeljeno'])
  expect(world.sent[0]?.idempotencyKey).toContain(entryId)
  expect(world.settled).toEqual(['sent'])
  expect(world.row()).toMatchObject({ state: 'sent', attemptCount: 4 })
  expect(logged(world).rest).toEqual({
    event: 'mail_outbox.resend',
    entryId,
    kind: 'work_order',
    outcome: 'sent',
  })
  expect(JSON.stringify(logged(world).line)).not.toContain(email)
  expect(JSON.stringify(logged(world).line)).not.toContain(guest)
})

it('sends no longer yours after the Ride is cancelled, and drops it when that Driver has a newer work order', async () => {
  const kept = harness(failed({ status: 'no_longer_yours', rideCancelled: true, message: { ...message, subject: 'Više nije vaše' } }))
  await expect(kept.resend()).resolves.toBe('sent')
  expect(kept.sent.map(mail => mail.subject)).toEqual(['Više nije vaše'])

  const replaced = harness(failed({ status: 'no_longer_yours', superseded: true }))
  await expect(replaced.resend()).resolves.toBe('stale')
  expect(replaced.sent).toHaveLength(0)
  expect(replaced.row()).toMatchObject({ state: 'stale', attemptCount: 4 })
  expect(logged(replaced).rest).toMatchObject({ outcome: 'stale', kind: 'work_order' })
})

it('marks a finished Ride stale and sends nothing', async () => {
  const world = harness(failed({ rideFinished: true }))
  await expect(world.resend()).resolves.toBe('stale')
  expect(world.sent).toHaveLength(0)
  expect(world.settled).toEqual(['stale'])
  expect(world.logs.lines()).toHaveLength(1)
})

it('keeps failed when the provider rejects the send, and does not start another cycle', async () => {
  const world = harness(failed())
  world.failSend()
  await expect(world.resend()).resolves.toBe('failed')
  expect(world.settled).toEqual([])
  expect(world.row()).toMatchObject({ state: 'failed', attemptCount: 4, nextAttemptAt: null })
  expect(logged(world).rest).toMatchObject({ outcome: 'failed' })
  expect(JSON.stringify(logged(world).line)).not.toContain(email)
})

it('keeps failed when the address is blank or the mail cannot be composed', async () => {
  const blank = harness(failed({ email: '   ' }))
  await expect(blank.resend()).resolves.toBe('failed')
  expect(blank.sent).toHaveLength(0)
  expect(blank.row()?.state).toBe('failed')

  const composed = harness(failed())
  composed.failCompose()
  await expect(composed.resend()).resolves.toBe('failed')
  expect(composed.sent).toHaveLength(0)
  expect(composed.settled).toEqual([])
})

it('does nothing for a missing row or a row that is not failed', async () => {
  const missing = harness(null)
  await expect(missing.resend()).resolves.toBe('missing')
  expect(missing.logs.lines()).toHaveLength(0)

  const sent = harness(failed({ state: 'sent' }))
  await expect(sent.resend()).resolves.toBe('missing')
  expect(sent.sent).toHaveLength(0)
  expect(sent.logs.lines()).toHaveLength(0)
})

it('still aborts when the Resend transport is selected in test', async () => {
  const world = harness(failed())
  await expect(resendFailedWorkOrder({
    entryId,
    log: world.logs.logger,
    store: {
      async load() {
        return failed()
      },
      async settle() {
        throw new Error('should not settle')
      },
    },
    mailer: {
      async sendWorkOrder() {
        throw new ResendTransportError()
      },
    },
  })).rejects.toBeInstanceOf(ResendTransportError)
  expect(world.logs.lines()).toHaveLength(0)
})
