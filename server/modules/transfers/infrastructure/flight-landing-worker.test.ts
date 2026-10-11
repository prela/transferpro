import type { JobQueue, QueuedJob, ScheduledJob, TenantTransaction } from '../../../core/index'
import { describe, expect, it } from 'vitest'
import { FLIGHT_ASK_EVERY_MINUTES } from '../../../../shared'
import { captureLogs } from '../../../core/testing'
import { FLIGHT_LANDING_ASK, FLIGHT_LANDING_TICK, registerFlightLanding } from './flight-landing-worker'

const tenantId = '11111111-1111-4111-8111-111111111111'
const askedAt = new Date('2026-10-11T10:00:00.000Z')

function fakeQueue() {
  const scheduled: Array<{ name: string, cron: string, data: unknown }> = []
  const published: Array<{ tenantId: string, name: string, data: unknown }> = []
  let onTick: ((job: ScheduledJob, publish: (tenantId: string, name: string, data: unknown) => Promise<void>) => Promise<void>) | undefined
  let onAsk: ((job: QueuedJob, scope: { transaction: TenantTransaction }) => Promise<void>) | undefined

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
    async work(_name, handle) {
      onAsk = handle
    },
    async close() {},
  }

  return { queue, scheduled, published, tick, ask }

  async function tick() {
    const handle = onTick
    if (!handle)
      throw new Error('tick worker was not registered')
    await handle(
      { id: 'tick-1', name: FLIGHT_LANDING_TICK, data: {} },
      async (id, name, data) => {
        published.push({ tenantId: id, name, data })
      },
    )
  }

  async function ask(transaction: TenantTransaction) {
    const handle = onAsk
    if (!handle)
      throw new Error('ask worker was not registered')
    await handle(
      {
        id: 'ask-1',
        name: FLIGHT_LANDING_ASK,
        tenantId,
        data: { askedAt: askedAt.toISOString() },
      },
      { transaction },
    )
  }
}

describe('flight landing schedule', () => {
  it('asks every 15 minutes through the queue, one envelope job per Tenant', async () => {
    const seen: string[] = []
    const statusCalls: unknown[] = []
    const queries: string[] = []
    const { queue, scheduled, published, tick, ask } = fakeQueue()
    const logs = captureLogs()

    await registerFlightLanding(queue, {
      log: logs.logger,
      status: {
        async arrivals(query) {
          statusCalls.push(query)
          return []
        },
      },
      now: () => askedAt,
      async listTenantIds() {
        return [tenantId]
      },
    })

    expect(scheduled).toEqual([{
      name: FLIGHT_LANDING_TICK,
      cron: `*/${FLIGHT_ASK_EVERY_MINUTES} * * * *`,
      data: {},
    }])
    expect(FLIGHT_ASK_EVERY_MINUTES).toBe(15)

    await tick()
    expect(published).toEqual([{
      tenantId,
      name: FLIGHT_LANDING_ASK,
      data: { askedAt: askedAt.toISOString() },
    }])
    expect(JSON.stringify(published)).not.toMatch(/OU|DBV|guest/i)

    const transaction: TenantTransaction = {
      async execute(query: { queryChunks?: unknown[] }) {
        queries.push(JSON.stringify(query))
        seen.push('session-already-open')
        return { rows: [] }
      },
    }
    await ask(transaction)
    expect(seen).toEqual(['session-already-open'])
    expect(statusCalls).toEqual([])
    expect(queries.some(query => query.includes('set_config'))).toBe(false)
  })
})
