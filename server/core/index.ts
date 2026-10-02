/**
 * Kernel entry. No Drizzle, pg-boss, or Nuxt.
 * Application code enqueues here. The adapter lives in infrastructure.ts.
 * Env is parsed here so boot can reject a bad config before that adapter loads.
 */
import process from 'node:process'
import { z } from 'zod'

/**
 * Runtime configuration, parsed once at boot.
 * The migrator URL is absent: migrations are not a runtime connection.
 */
export interface AppEnv {
  readonly DATABASE_URL: string
  readonly AUTH_DATABASE_URL: string
  readonly QUEUE_DATABASE_URL: string
  readonly BETTER_AUTH_SECRET: string
  readonly BETTER_AUTH_URL: string
}

/**
 * App env only. `DATABASE_MIGRATE_URL` is the migrator and is not a field:
 * boot must not be able to open that connection by reading its own config.
 */
const appEnvSchema = z.object({
  DATABASE_URL: z.url(),
  AUTH_DATABASE_URL: z.url(),
  QUEUE_DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
})

/** Parse one source. Boot uses `loadAppEnv`, which caches this. */
export function parseAppEnv(source: NodeJS.ProcessEnv): AppEnv {
  return appEnvSchema.parse({
    DATABASE_URL: source.DATABASE_URL,
    AUTH_DATABASE_URL: source.AUTH_DATABASE_URL,
    QUEUE_DATABASE_URL: source.QUEUE_DATABASE_URL,
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL,
  })
}

let cached: AppEnv | undefined

/**
 * The process environment, parsed on the first call and reused after that.
 * A second call does not read `process.env` again, so a later mutation
 * cannot swap the runtime role out from under a running process.
 */
export function loadAppEnv(): AppEnv {
  cached ??= parseAppEnv(process.env)
  return cached
}

/**
 * Parse once, then refuse to start if the app, auth, or queue role is
 * over-privileged. The privilege query lives in the adapter.
 */
export async function boot(): Promise<AppEnv> {
  const env = loadAppEnv()
  const { assertRuntimeRoles } = await import('./infrastructure')
  await assertRuntimeRoles(env)
  return env
}

/**
 * Minted by the kernel for one call. The queue copies `tenantId` onto the
 * job. Callers do not pass a tenant id of their own.
 */
export interface TenantContext {
  readonly tenantId: string
}

/**
 * The caller's open transaction, or the one the worker opened.
 * `execute` takes `any` so this port can accept a Drizzle transaction
 * without importing Drizzle. The adapter is what actually calls it.
 */
export interface TenantTransaction {
  execute: (query: any) => Promise<unknown>
}

/** A job as the worker hands it to the handler. `data` is the caller's payload. */
export interface QueuedJob {
  readonly id: string
  readonly name: string
  readonly tenantId: string
  readonly data: unknown
}

export interface JobHandlerScope {
  /** App-role transaction with `app.tenant_id` set from the job. */
  readonly transaction: TenantTransaction
}

export interface JobQueue {
  /**
   * Insert one job in `transaction`. A rollback of that transaction
   * removes the job. The tenant is `context.tenantId`, not a field of `data`.
   */
  enqueue: (
    context: TenantContext,
    transaction: TenantTransaction,
    name: string,
    data: unknown,
  ) => Promise<void>

  /**
   * Claim one waiting job and run `handle` inside a new tenant transaction.
   * Null when the queue has nothing to take.
   */
  handleNext: (
    name: string,
    handle: (job: QueuedJob, scope: JobHandlerScope) => Promise<void>,
  ) => Promise<QueuedJob | null>

  close: () => Promise<void>
}
