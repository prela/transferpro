import type { AppEnv, JobQueue } from '../../../core/index'
import process from 'node:process'
import { loadAppEnv, nodeEnv } from '../../../core/index'
import { createPgBossJobQueue } from '../../../core/infrastructure'

let queuePromise: Promise<JobQueue> | undefined

/**
 * Close the pools this process opened. A second call does nothing.
 * Tests call this so a later file can start a fresh queue, and so the
 * process can exit. Production stops with the server.
 */
export async function closeMailOutboxQueue(): Promise<void> {
  const pending = queuePromise
  queuePromise = undefined
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
 * Later calls share it: the Ride transaction, the invite call, and the worker.
 */
export function mailOutboxQueue(env: AppEnv = loadAppEnv()): Promise<JobQueue> {
  queuePromise ??= createPgBossJobQueue(env)
  return queuePromise
}
