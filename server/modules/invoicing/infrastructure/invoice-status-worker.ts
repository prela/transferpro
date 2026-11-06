import type { AppEnv, JobQueue, Logger } from '../../../core/index'
import type { InvoiceStatusRead } from '../application/port'
import pg from 'pg'
import { z } from 'zod'
import { getLogger, loadAppEnv } from '../../../core/index'
import { createPgBossJobQueue } from '../../../core/infrastructure'
import { applyInvoiceStatusReads } from '../application/status'
import { INVOICE_STATUS_EVERY_MINUTES } from '../domain/invoice'
import { invoicingPort, invoicingPortForTenant } from './invoice-job'
import { loadInvoiceStatusCandidates, saveInvoiceStatusEffect } from './invoice-status'

/**
 * Recurring tick. Its payload is empty: no invoice id, number, or Tenant.
 * It is not one Tenant. Each due Tenant is a separate job.
 */
export const INVOICE_STATUS_TICK = 'invoice-status'

/**
 * One Tenant, stamped on the envelope. The payload is the tick instant only.
 */
export const INVOICE_STATUS_CHECK = 'invoice-status-check'

export const INVOICE_STATUS_CRON = `*/${INVOICE_STATUS_EVERY_MINUTES} * * * *`

const askedAtSchema = z.object({
  askedAt: z.iso.datetime(),
})

/**
 * Register the 15-minute tick and the per-Tenant check.
 * The tick lists Tenant ids and publishes one check each. That job's
 * envelope carries the Tenant. The payload is the tick's instant.
 * `none` does not schedule: nothing is issued, and nothing is read.
 * `fake` and `current` call the port. `current` uses one adapter per Tenant.
 */
export async function registerInvoiceStatus(
  queue: JobQueue,
  options: {
    readonly log: Logger
    readonly port: { readStatus: (toolInvoiceId: string) => Promise<InvoiceStatusRead> }
    readonly listTenantIds: () => Promise<readonly string[]>
    readonly enabled: boolean
    /** False when invoicing is off. `current` calls the real adapter. */
    readonly callPort: boolean
    /** One port per Tenant. The status job's budget stays in the caller. */
    readonly portForTenant?: (tenantId: string) => { readStatus: (toolInvoiceId: string) => Promise<InvoiceStatusRead> }
    readonly now?: () => Date
  },
): Promise<void> {
  if (!options.enabled)
    return
  const workInSteps = queue.workInSteps
  if (workInSteps === undefined)
    throw new Error('invoice-status needs a queue that commits each step.')
  const now = options.now ?? (() => new Date())
  await queue.schedule(INVOICE_STATUS_TICK, INVOICE_STATUS_CRON, {})
  await queue.workScheduled(INVOICE_STATUS_TICK, async (_job, publish) => {
    const askedAt = now()
    for (const tenantId of await options.listTenantIds())
      await publish(tenantId, INVOICE_STATUS_CHECK, { askedAt: askedAt.toISOString() })
  })
  await workInSteps(INVOICE_STATUS_CHECK, async (job, step) => {
    const asked = new Date(askedAtSchema.parse(job.data).askedAt)
    if (!options.callPort)
      return
    const candidates = await step(transaction => loadInvoiceStatusCandidates(transaction))
    const effects = await applyInvoiceStatusReads({
      candidates,
      port: options.portForTenant?.(job.tenantId) ?? options.port,
      log: options.log,
    })
    for (const effect of effects)
      await step(transaction => saveInvoiceStatusEffect(transaction, effect, asked))
  })
}

/** Tenants with a created, cancelling, or unsent-storno invoice. Tenant ids only. */
export async function listTenantsDueInvoiceStatus(pool: pg.Pool): Promise<string[]> {
  const listed = await pool.query('select tenant_id from app.tenants_due_invoice_status()')
  return z.array(z.object({ tenant_id: z.uuid() })).parse(listed.rows).map(row => row.tenant_id)
}

let started = false

/**
 * Schedule the check when invoicing is on. `none` returns before a queue
 * exists. `fake` uses the in-process port. `current` uses the real adapter.
 */
export async function startInvoiceStatusWorker(env: AppEnv = loadAppEnv(), log: Logger = getLogger()): Promise<void> {
  if (env.INVOICING === 'none')
    return
  if (started)
    return
  started = true
  const queue = await createPgBossJobQueue(env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })
  await registerInvoiceStatus(queue, {
    log,
    port: env.INVOICING === 'fake'
      ? invoicingPort()
      : {
          async readStatus() {
            throw new Error('Invoice status for the current tool uses the tenant port.')
          },
        },
    portForTenant: env.INVOICING === 'current' ? invoicingPortForTenant : undefined,
    enabled: true,
    callPort: true,
    listTenantIds: () => listTenantsDueInvoiceStatus(pool),
  })
}
