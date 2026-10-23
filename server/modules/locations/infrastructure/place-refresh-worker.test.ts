import type { JobQueue, QueuedJob, ScheduledJob, TenantTransaction } from '../../../core/index'
import { describe, expect, it } from 'vitest'
import { parseAppEnv } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { PLACE_REFRESH_CHECK, PLACE_REFRESH_CRON, PLACE_REFRESH_TICK, registerPlaceRefresh, startPlaceRefreshWorker } from './place-refresh-worker'

const tenantId = '11111111-1111-4111-8111-111111111111'
const askedAt = new Date('2026-10-23T03:00:00.000Z')

const envBase = {
  DATABASE_URL: 'postgres://app@127.0.0.1:5432/transferpro',
  AUTH_DATABASE_URL: 'postgres://auth@127.0.0.1:5432/transferpro',
  QUEUE_DATABASE_URL: 'postgres://queue@127.0.0.1:5432/transferpro',
  PLATFORM_DATABASE_URL: 'postgres://platform@127.0.0.1:5432/transferpro',
  BETTER_AUTH_SECRET: 'transferpro-test-secret-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
}

function fakeQueue() {
  const scheduled: Array<{ name: string, cron: string, data: unknown }> = []
  const published: Array<{ tenantId: string, name: string, data: unknown }> = []
  let onTick: ((job: ScheduledJob, publish: (tenantId: string, name: string, data: unknown) => Promise<void>) => Promise<void>) | undefined
  let onCheck: ((job: QueuedJob, scope: { transaction: TenantTransaction }) => Promise<void>) | undefined

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
      { id: 'tick-1', name: PLACE_REFRESH_TICK, data: {} },
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
        name: PLACE_REFRESH_CHECK,
        tenantId,
        data: { askedAt: askedAt.toISOString() },
      },
      { transaction },
    )
  }
}

describe('place refresh schedule', () => {
  it('checks at 03:00 UTC through the queue, one envelope job per Tenant', async () => {
    const seen: string[] = []
    const checks: string[] = []
    const queries: string[] = []
    const { queue, scheduled, published, tick, check } = fakeQueue()
    const logs = captureLogs()

    await registerPlaceRefresh(queue, {
      maps: 'google',
      log: logs.logger,
      now: () => askedAt,
      async listTenantIds() {
        return [tenantId]
      },
      places: {
        async checkPlaceRef(placeRef) {
          checks.push(placeRef)
          return { outcome: 'unavailable' }
        },
      },
    })

    expect(scheduled).toEqual([{
      name: PLACE_REFRESH_TICK,
      cron: PLACE_REFRESH_CRON,
      data: {},
    }])
    expect(PLACE_REFRESH_CRON).toBe('0 3 * * *')

    await tick()
    expect(published).toEqual([{
      tenantId,
      name: PLACE_REFRESH_CHECK,
      data: { askedAt: askedAt.toISOString() },
    }])
    expect(JSON.stringify(published)).not.toMatch(/ChIJ|Put 1/)

    const transaction: TenantTransaction = {
      async execute(query: { queryChunks?: unknown[] }) {
        queries.push(JSON.stringify(query))
        seen.push('session-already-open')
        return { rows: [] }
      },
    }
    await check(transaction)
    expect(seen).toEqual(['session-already-open'])
    expect(checks).toEqual([])
    expect(queries.some(query => query.includes('set_config'))).toBe(false)
  })

  it('does not schedule a tick when maps are off', async () => {
    const { queue, scheduled, tick } = fakeQueue()
    await registerPlaceRefresh(queue, {
      maps: 'none',
      log: captureLogs().logger,
      now: () => askedAt,
      async listTenantIds() {
        return [tenantId]
      },
      places: {
        async checkPlaceRef() {
          throw new Error('maps none must not check a place')
        },
      },
    })
    expect(scheduled).toEqual([])
    await expect(tick()).rejects.toThrow('tick worker was not registered')
    await expect(startPlaceRefreshWorker(parseAppEnv(envBase))).resolves.toBeUndefined()
  })
})
