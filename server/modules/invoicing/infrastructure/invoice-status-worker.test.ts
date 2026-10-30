import type { JobQueue, QueuedJob, ScheduledJob, TenantTransaction } from '../../../core/index'
import { describe, expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { INVOICE_STATUS_CHECK, INVOICE_STATUS_CRON, INVOICE_STATUS_TICK, registerInvoiceStatus } from './invoice-status-worker'

const tenantId = '11111111-1111-4111-8111-111111111111'
const askedAt = new Date('2026-10-15T10:00:00.000Z')

function fakeQueue() {
  const scheduled: Array<{ name: string, cron: string, data: unknown }> = []
  const published: Array<{ tenantId: string, name: string, data: unknown }> = []
  let onTick: ((job: ScheduledJob, publish: (tenantId: string, name: string, data: unknown) => Promise<void>) => Promise<void>) | undefined
  let onCheck: ((
    job: QueuedJob,
    step: <T>(run: (transaction: TenantTransaction) => Promise<T>) => Promise<T>,
  ) => Promise<void>) | undefined

  const queue: JobQueue = {
    async enqueue() {},
    async handleNext() {
      return null
    },
    async schedule(name, cron, data) {
      scheduled.push({ name, cron, data })
    },
    async workScheduled(_name, handle) {
      onTick = handle
    },
    async work() {},
    async workInSteps(_name, handle) {
      onCheck = handle
    },
    async close() {},
  }

  return { queue, scheduled, published, tick, check }

  async function tick() {
    const handle = onTick
    if (!handle)
      throw new Error('tick worker was not registered')
    await handle(
      { id: 'tick-1', name: INVOICE_STATUS_TICK, data: {} },
      async (id, name, data) => {
        published.push({ tenantId: id, name, data })
      },
    )
  }

  async function check(transaction: TenantTransaction) {
    const handle = onCheck
    if (!handle)
      throw new Error('check worker was not registered')
    await handle(
      {
        id: 'check-1',
        name: INVOICE_STATUS_CHECK,
        tenantId,
        data: { askedAt: askedAt.toISOString() },
      },
      async run => run(transaction),
    )
  }
}

describe('invoice status schedule', () => {
  it('checks every 15 minutes, one envelope job per Tenant, with only the tick instant', async () => {
    const queries: string[] = []
    const reads: string[] = []
    const { queue, scheduled, published, tick, check } = fakeQueue()
    const logs = captureLogs()

    await registerInvoiceStatus(queue, {
      log: logs.logger,
      enabled: true,
      callPort: true,
      now: () => askedAt,
      port: {
        async readStatus(toolInvoiceId: string) {
          reads.push(toolInvoiceId)
          return { sent: false, storno: null }
        },
      },
      async listTenantIds() {
        return [tenantId]
      },
    })

    expect(scheduled).toEqual([{
      name: INVOICE_STATUS_TICK,
      cron: INVOICE_STATUS_CRON,
      data: {},
    }])
    expect(INVOICE_STATUS_CRON).toBe('*/15 * * * *')

    await tick()
    expect(published).toEqual([{
      tenantId,
      name: INVOICE_STATUS_CHECK,
      data: { askedAt: askedAt.toISOString() },
    }])
    expect(JSON.stringify(published)).not.toMatch(/invoice number|guest|@/i)

    const transaction: TenantTransaction = {
      async execute(query: { queryChunks?: unknown[] }) {
        queries.push(JSON.stringify(query))
        return { rows: [] }
      },
    }
    await check(transaction)
    expect(reads).toEqual([])
    expect(queries.some(query => query.includes('status_checked_at'))).toBe(true)
    expect(queries.some(query => query.includes('nulls first'))).toBe(true)
    expect(queries.some(query => query.includes('set_config'))).toBe(false)
  })

  it('does not schedule when invoicing is off', async () => {
    const { queue, scheduled } = fakeQueue()
    await registerInvoiceStatus(queue, {
      log: captureLogs().logger,
      enabled: false,
      callPort: false,
      port: { async readStatus() { return { sent: false, storno: null } } },
      async listTenantIds() {
        return [tenantId]
      },
    })
    expect(scheduled).toEqual([])
  })
})
