import { expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { ResendTransportError } from '../../tenancy'
import { deliverNewInvitation } from './invitation'

const entryId = 'e1e1e1e1-1111-4111-8111-111111111111'
const invitationId = '6b1e0c3a-4444-4444-8444-444444444444'
const email = 'pozvana@example.test'

/** The record and the attempt are the outbox writes. Nothing here touches Postgres. */
function bare(lines: ReturnType<typeof captureLogs>) {
  return lines.lines().map(({ level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest }) => rest)
}

it('reports sent after the entry is written and the first attempt goes out', async () => {
  const logs = captureLogs()
  const attempted: string[] = []
  const outcome = await deliverNewInvitation({
    record: async () => entryId,
    attempt: async (id) => {
      attempted.push(id)
      return 'sent'
    },
    log: logs.logger,
  })
  expect(outcome).toBe('sent')
  expect(attempted).toEqual([entryId])
})

it('reports retrying when the first attempt fails, because the queued job tries again', async () => {
  const logs = captureLogs()
  expect(await deliverNewInvitation({
    record: async () => entryId,
    attempt: async () => 'pending',
    log: logs.logger,
  })).toBe('retrying')
})

it('reports stale when the invitation stopped being pending before the first attempt', async () => {
  const logs = captureLogs()
  expect(await deliverNewInvitation({
    record: async () => entryId,
    attempt: async () => 'stale',
    log: logs.logger,
  })).toBe('stale')
})

it('reports not sent and makes no attempt when the entry cannot be written, and logs neither the address nor the id', async () => {
  const logs = captureLogs()
  let attempted = false
  const outcome = await deliverNewInvitation({
    record: async () => {
      throw new Error(`insert failed ${email} ${invitationId}`)
    },
    attempt: async () => {
      attempted = true
      return 'sent'
    },
    log: logs.logger,
  })
  expect(outcome).toBe('not_sent')
  expect(attempted).toBe(false)
  expect(bare(logs)).toEqual([{ event: 'mail_outbox.invitation_not_recorded' }])
  expect(JSON.stringify(logs.lines())).not.toContain(email)
  expect(JSON.stringify(logs.lines())).not.toContain(invitationId)
})

it('reports retrying when the first attempt throws after the entry exists, and logs only the entry id', async () => {
  const logs = captureLogs()
  const outcome = await deliverNewInvitation({
    record: async () => entryId,
    attempt: async () => {
      throw new Error(`auth read failed ${email} ${invitationId}`)
    },
    log: logs.logger,
  })
  expect(outcome).toBe('retrying')
  expect(bare(logs)).toEqual([{ event: 'mail_outbox.first_attempt_failed', entryId }])
  expect(JSON.stringify(logs.lines())).not.toContain(email)
  expect(JSON.stringify(logs.lines())).not.toContain(invitationId)
})

it('still fails the invite when the Resend transport is selected in test', async () => {
  const logs = captureLogs()
  await expect(deliverNewInvitation({
    record: async () => entryId,
    attempt: async () => {
      throw new ResendTransportError()
    },
    log: logs.logger,
  })).rejects.toBeInstanceOf(ResendTransportError)
})
