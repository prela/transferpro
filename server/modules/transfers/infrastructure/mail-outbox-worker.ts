import type { AppEnv, Logger, TenantContext, TenantTransaction } from '../../../core/index'
import type { OutboxAttemptStore } from '../../mail'
import { getLogger, loadAppEnv } from '../../../core/index'
import { closeMailOutboxQueue as closeQueue, handleMailOutboxJob, invitationAttemptStore, MAIL_OUTBOX_QUEUE, mailOutboxQueue, outboxStoreByKind } from '../../mail'
import { mailerForApp } from '../../tenancy'
import { outboxAttemptStore } from './work-order-attempt'

let starting: Promise<void> | undefined

/**
 * The queue lives in the mail module, which the invite call shares.
 * These names stay here for the Ride actions and the tests that import them.
 */
export { mailOutboxQueue }

/** Close the shared queue and let a later call start the worker again. */
export async function closeMailOutboxQueue(): Promise<void> {
  starting = undefined
  await closeQueue()
}

/** A work order reads the Ride. An invitation reads Better Auth's row for this Tenant. */
export function mailOutboxStore(transaction: TenantTransaction, context: TenantContext): OutboxAttemptStore {
  return outboxStoreByKind(transaction, {
    work_order: outboxAttemptStore(transaction),
    invitation: invitationAttemptStore(transaction, context),
  })
}

/**
 * Worker for retries. The envelope restores the Tenant and the request id
 * before this handler runs. The mailer is the same one the first attempt uses,
 * so the allowlist and the test fake still decide delivery.
 */
export function startMailOutboxWorker(env: AppEnv = loadAppEnv(), log: Logger = getLogger()): Promise<void> {
  starting ??= start(env, log)
  return starting
}

async function start(env: AppEnv, log: Logger): Promise<void> {
  const queue = await mailOutboxQueue(env)
  const mailer = mailerForApp(env)
  await queue.work(MAIL_OUTBOX_QUEUE, async (job, scope) => {
    await handleMailOutboxJob(job, scope, {
      mailer,
      queue,
      log,
      now: () => new Date(),
      openStore: mailOutboxStore,
    })
  })
}
