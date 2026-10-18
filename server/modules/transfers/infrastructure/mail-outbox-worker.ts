import type { AppEnv, JobQueue, Logger } from '../../../core/index'
import process from 'node:process'
import { getLogger, loadAppEnv, nodeEnv } from '../../../core/index'
import { createPgBossJobQueue } from '../../../core/infrastructure'
import { handleMailOutboxJob, MAIL_OUTBOX_QUEUE } from '../../mail'
import { mailerForApp } from '../../tenancy'
import { outboxAttemptStore } from './work-order-attempt'

let queuePromise: Promise<JobQueue> | undefined
let starting: Promise<void> | undefined

/**
 * Close the pools this process opened. A second call does nothing.
 * Tests call this so a later file can start a fresh queue, and so the
 * process can exit. Production stops with the server.
 */
export async function closeMailOutboxQueue(): Promise<void> {
  const pending = queuePromise
  queuePromise = undefined
  starting = undefined
  if (pending)
    await (await pending).close()
}

// A test process enqueues on the real queue and then exits. Close the pools
// or the open connections keep the process alive.
if (nodeEnv() === 'test') {
  process.once('beforeExit', () => {
    void closeMailOutboxQueue()
  })
}

/**
 * The one queue for this process. The first call starts pg-boss.
 * Later calls share it, including the Ride transaction that enqueues.
 */
export function mailOutboxQueue(env: AppEnv = loadAppEnv()): Promise<JobQueue> {
  queuePromise ??= createPgBossJobQueue(env)
  return queuePromise
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
      openStore: outboxAttemptStore,
    })
  })
}
