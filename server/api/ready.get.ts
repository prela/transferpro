import { defineEventHandler } from 'h3'
import { assertReady } from '../core/index'

/**
 * Coolify's container health check calls this. No session: the probe is
 * the process, not a Tenant. `assertReady` opens the runtime roles and
 * refuses a dead database or an over-privileged role. The body is one
 * word. Role names and connection strings stay off it.
 */
export default defineEventHandler(async () => {
  await assertReady()
  return { status: 'ok' }
})
