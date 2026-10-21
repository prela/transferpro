import type { JobQueue, QueuedJob, ScheduledJob, TenantTransaction } from '../../../core/index'
import { describe, expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { CONTACT_PERSON_RETENTION_CRON, CONTACT_PERSON_RETENTION_DELETE, CONTACT_PERSON_RETENTION_TICK, registerContactPersonRetention } from './retention'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-10-19T03:45:00.000Z')
const cutoff = '2026-07-21T03:45:00.000Z'

type TickHandler = (job: ScheduledJob, publish: (tenantId: string, name: string, data: unknown) => Promise<void>) => Promise<void>
type JobHandler = (job: QueuedJob, scope: { transaction: TenantTransaction }) => Promise<void>

function fakeQueue() {
  const scheduled: Array<{ name: string, cron: string, data: unknown }> = []
  const published: Array<{ tenantId: string, name: string, data: unknown }> = []
  const workers = new Map<string, TickHandler | JobHandler>()

  const queue: JobQueue = {
    async enqueue() {},
    async handleNext() {
      return null
    },
    async schedule(name, cron, data) {
      scheduled.push({ name, cron, data })
    },
    async workScheduled(name, handle) {
      workers.set(name, handle)
    },
    async work(name, handle) {
      workers.set(name, handle)
    },
    async close() {},
  }

  async function tick() {
    const handle = workers.get(CONTACT_PERSON_RETENTION_TICK) as TickHandler | undefined
    if (!handle)
      throw new Error('tick worker was not registered')
    await handle({ id: 'tick-1', name: CONTACT_PERSON_RETENTION_TICK, data: {} }, async (tenantId, name, data) => {
      published.push({ tenantId, name, data })
    })
  }

  async function remove(transaction: TenantTransaction, data: unknown) {
    const handle = workers.get(CONTACT_PERSON_RETENTION_DELETE) as JobHandler | undefined
    if (!handle)
      throw new Error('delete worker was not registered')
    await handle({ id: 'job-1', name: CONTACT_PERSON_RETENTION_DELETE, tenantId: tenantA, data }, { transaction })
  }

  return { queue, scheduled, published, tick, remove }
}

function recordingTransaction(rowCount: number) {
  const queries: string[] = []
  const transaction: TenantTransaction = {
    async execute(query: unknown) {
      queries.push(JSON.stringify(query))
      return { rows: [], rowCount }
    },
  }
  return { transaction, queries }
}

describe('contact person retention', () => {
  it('runs once a day and fans out one delete job per Tenant with persons removed long ago', async () => {
    const { queue, scheduled, published, tick } = fakeQueue()
    const asked: Date[] = []
    await registerContactPersonRetention(queue, {
      log: captureLogs().logger,
      now: () => now,
      async listTenantIds(before) {
        asked.push(before)
        return [tenantA, tenantB]
      },
    })

    expect(scheduled).toEqual([{ name: CONTACT_PERSON_RETENTION_TICK, cron: CONTACT_PERSON_RETENTION_CRON, data: {} }])
    expect(CONTACT_PERSON_RETENTION_CRON).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/)

    await tick()
    expect(asked.map(instant => instant.toISOString())).toEqual([cutoff])
    expect(published).toEqual([
      { tenantId: tenantA, name: CONTACT_PERSON_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
      { tenantId: tenantB, name: CONTACT_PERSON_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
    ])
  })

  it('deletes on the open tenant session and logs the count only', async () => {
    const { queue, remove } = fakeQueue()
    const logs = captureLogs()
    await registerContactPersonRetention(queue, { log: logs.logger, now: () => now, listTenantIds: async () => [] })
    const { transaction, queries } = recordingTransaction(3)

    await remove(transaction, { askedAt: now.toISOString() })

    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('delete from app.client_contact_persons')
    expect(queries[0]).toContain(cutoff)
    expect(queries[0]).toContain('removed_at <')
    // The job envelope already opened the session. The handler does not choose a Tenant.
    expect(queries[0]).not.toContain('set_config')
    expect(queries[0]).not.toContain(tenantA)
    const lines = logs.lines()
    expect(lines).toHaveLength(1)
    const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...fields } = lines[0] ?? {}
    expect(fields).toEqual({ event: 'contact_person.retention_deleted', deleted: 3 })
  })

  it('never takes a cutoff later than 90 days before the clock, whatever the payload says', async () => {
    const { queue, remove } = fakeQueue()
    await registerContactPersonRetention(queue, { log: captureLogs().logger, now: () => now, listTenantIds: async () => [] })
    const { transaction, queries } = recordingTransaction(0)

    await remove(transaction, { askedAt: '2027-12-31T00:00:00.000Z' })

    expect(queries[0]).toContain(cutoff)
  })

  it('refuses a payload without an instant and deletes nothing', async () => {
    const { queue, remove } = fakeQueue()
    await registerContactPersonRetention(queue, { log: captureLogs().logger, now: () => now, listTenantIds: async () => [] })
    const { transaction, queries } = recordingTransaction(0)

    await expect(remove(transaction, { before: cutoff })).rejects.toThrow()
    expect(queries).toEqual([])
  })
})
