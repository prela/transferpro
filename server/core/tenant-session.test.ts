import { expect, it } from 'vitest'
import { openTenantSession } from './index'
import { captureLogs } from './testing'

/**
 * Tenant-session seam: the kernel helper takes a TenantContext, sets
 * `app.tenant_id`, and binds the log scope for that call only.
 */
it('binds tenant_id for the call that sets the tenant session', async () => {
  const logs = captureLogs()
  const executed: unknown[] = []
  const transaction = {
    async execute(query: unknown) {
      executed.push(query)
    },
  }
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  await openTenantSession(transaction, { tenantId }, async () => {
    logs.logger.info({ event: 'inside' })
  })
  logs.logger.info({ event: 'outside' })

  const [inside, outside] = logs.lines()
  expect(executed).toHaveLength(1)
  expect(inside).toMatchObject({ event: 'inside', tenant_id: tenantId })
  expect(inside?.request_id).toBeUndefined()
  expect(outside).toMatchObject({ event: 'outside' })
  expect(outside?.tenant_id).toBeUndefined()
})
