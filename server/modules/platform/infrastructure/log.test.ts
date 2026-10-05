import { expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { writePlatformLog } from './log'

it('writes the actor, the action, the target, and the outcome, and nothing named', () => {
  const captured = captureLogs()
  writePlatformLog(captured.logger, {
    userId: '6b1e0c3a-2222-4222-8222-222222222222',
    action: 'platform.tenants.rename',
    targetTenantId: '7c2f1d4b-3333-4333-8333-333333333333',
    outcome: 'ok',
  })
  writePlatformLog(captured.logger, {
    userId: null,
    action: 'platform.tenants.open',
    targetTenantId: null,
    outcome: 'forbidden',
  })
  writePlatformLog(captured.logger, {
    userId: '6b1e0c3a-2222-4222-8222-222222222222',
    action: 'platform.session',
    targetTenantId: null,
    outcome: 'error',
  })

  const lines = captured.lines()
  expect(lines.map(line => line.level)).toEqual([30, 30, 50])
  expect(lines.map(line => line.msg)).toEqual(['platform', 'platform', 'platform'])
  expect(lines[0]).toMatchObject({
    userId: '6b1e0c3a-2222-4222-8222-222222222222',
    action: 'platform.tenants.rename',
    targetTenantId: '7c2f1d4b-3333-4333-8333-333333333333',
    outcome: 'ok',
  })
  for (const line of lines) {
    for (const absent of ['name', 'email', 'body', 'tenant_id'])
      expect(Object.keys(line)).not.toContain(absent)
  }
  const text = JSON.stringify(lines)
  expect(text).not.toContain('Mora')
  expect(text).not.toContain('ana@example.test')
})
