import { beforeEach, expect, it, vi } from 'vitest'

/**
 * HTTP seam for `GET /api/ready`. The probe itself is `guardReadiness`
 * and the real role check. This file only locks the status the route reports.
 */
const assertReady = vi.hoisted(() => vi.fn())

vi.mock('../core/index', () => ({
  assertReady,
}))

const handler = (await import('./ready.get')).default

beforeEach(() => {
  assertReady.mockReset()
})

it('returns ok when the runtime roles can use the database', async () => {
  assertReady.mockResolvedValue(undefined)
  await expect(handler({} as never)).resolves.toEqual({ status: 'ok' })
})

it('returns 503 when the database or a runtime role is refused', async () => {
  assertReady.mockRejectedValue(Object.assign(new Error('Not ready'), { statusCode: 503 }))
  await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 503 })
})
