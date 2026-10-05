/**
 * Kernel entry. No Drizzle, pg-boss, or Nuxt.
 * Application code enqueues here. The adapter lives in infrastructure.ts.
 * Env is parsed here so boot can reject a bad config before that adapter loads.
 */
import type { LogLevel } from './logger'
import process from 'node:process'
import { z } from 'zod'
import { configureLogger, logLevels } from './logger'

export { configureLogger, createLogger, currentRequestId, currentTenantId, endRequestLog, getLogger, handleLoggedError, openRequestLog, resolveRequestId, runWithRequestId } from './logger'
export type { Logger, LogLevel } from './logger'

/**
 * Runtime configuration, parsed once at boot.
 * The migrator URL is absent: migrations are not a runtime connection.
 */
export interface AppEnv {
  readonly DATABASE_URL: string
  readonly AUTH_DATABASE_URL: string
  readonly QUEUE_DATABASE_URL: string
  /**
   * `transferpro_platform`. Directory reads and renames only.
   * The migrator URL is still not a field of this object.
   */
  readonly PLATFORM_DATABASE_URL: string
  readonly BETTER_AUTH_SECRET: string
  readonly BETTER_AUTH_URL: string
  /** Pino level. Production defaults to `info`; anywhere else, `debug`. */
  readonly LOG_LEVEL: LogLevel
  /**
   * Which transport `mailerForApp` may select. Production is always `resend`.
   * Local and test leave this unset unless the operator opts in.
   */
  readonly MAILER: 'resend' | 'console' | undefined
  /**
   * Resend API key. Required in production together with `MAILER=resend`.
   * Optional in development and test so `pnpm dev` does not share the
   * daily quota. The name is redacted (`apikey`). ADR-0013.
   */
  readonly RESEND_API_KEY: string | undefined
  /**
   * Sentry or GlitchTip DSN. When unset, the SDK is not initialised and no
   * events are sent. ADR charter observability baseline (#34).
   */
  readonly SENTRY_DSN: string | undefined
  /** Git SHA or release name. Set in deployment; forwarded to Sentry as `release`. */
  readonly SENTRY_RELEASE: string | undefined
}

/**
 * App env only. `DATABASE_MIGRATE_URL` is the migrator and is not a field:
 * boot must not be able to open that connection by reading its own config.
 */
const appEnvSchema = z.object({
  DATABASE_URL: z.url(),
  AUTH_DATABASE_URL: z.url(),
  QUEUE_DATABASE_URL: z.url(),
  PLATFORM_DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
})

/**
 * Unset or blank means the caller did not choose. Production is `info`
 * so a deployed process stays quiet. Local and test stay on `debug`.
 */
const resendKeySchema = z.string().min(1)

function blankEnv(value: string | undefined): string | undefined {
  if (value === undefined || value === '')
    return undefined
  return value
}

/**
 * Production cannot boot without `MAILER=resend`. Anywhere else the
 * value is optional: unset means the console mailer in development
 * and the fake mailer in test.
 */
function parseMailer(source: NodeJS.ProcessEnv): 'resend' | 'console' | undefined {
  const raw = blankEnv(source.MAILER)
  if (source.NODE_ENV === 'production')
    return z.literal('resend').parse(raw)
  if (raw === undefined)
    return undefined
  return z.enum(['resend', 'console']).parse(raw)
}

/**
 * Production cannot boot without a key. Development and test omit it
 * so a local process does not send through the shared Resend quota.
 * A blank value counts as missing.
 */
function parseResendApiKey(source: NodeJS.ProcessEnv): string | undefined {
  const key = blankEnv(source.RESEND_API_KEY)
  if (source.NODE_ENV === 'production')
    return resendKeySchema.parse(key)
  if (key === undefined)
    return undefined
  return resendKeySchema.parse(key)
}

function parseSentryDsn(source: NodeJS.ProcessEnv): string | undefined {
  const dsn = blankEnv(source.SENTRY_DSN)
  if (dsn === undefined)
    return undefined
  return z.url().parse(dsn)
}

function parseSentryRelease(source: NodeJS.ProcessEnv): string | undefined {
  const release = blankEnv(source.SENTRY_RELEASE)
  if (release === undefined)
    return undefined
  return z.string().min(1).max(200).parse(release)
}

function parseLogLevel(source: NodeJS.ProcessEnv): LogLevel {
  const raw = source.LOG_LEVEL
  if (raw === undefined || raw === '')
    return source.NODE_ENV === 'production' ? 'info' : 'debug'
  return z.enum(logLevels).parse(raw)
}

/**
 * The live `NODE_ENV`. Nitro's production build replaces the token
 * `process.env.NODE_ENV` with `"production"`, which would force Secure
 * cookies and the sign-in limit on an http preview of the built server.
 * Bracket access keeps the process value, so Playwright can start that
 * server with `NODE_ENV=test`.
 */
export function nodeEnv(): string | undefined {
  // Bracket access: Nitro replaces the token `process.env.NODE_ENV` only.
  // eslint-disable-next-line dot-notation
  return process.env['NODE_ENV']
}

/** Parse one source. Boot uses `loadAppEnv`, which caches this. */
export function parseAppEnv(source: NodeJS.ProcessEnv): AppEnv {
  return {
    ...appEnvSchema.parse({
      DATABASE_URL: source.DATABASE_URL,
      AUTH_DATABASE_URL: source.AUTH_DATABASE_URL,
      QUEUE_DATABASE_URL: source.QUEUE_DATABASE_URL,
      PLATFORM_DATABASE_URL: source.PLATFORM_DATABASE_URL,
      BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: source.BETTER_AUTH_URL,
    }),
    LOG_LEVEL: parseLogLevel(source),
    MAILER: parseMailer(source),
    RESEND_API_KEY: parseResendApiKey(source),
    SENTRY_DSN: parseSentryDsn(source),
    SENTRY_RELEASE: parseSentryRelease(source),
  }
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
 * Parse once, then refuse to start if the app, auth, queue, or platform
 * role is over-privileged. The privilege query lives in the adapter.
 */
export async function boot(): Promise<AppEnv> {
  const env = loadAppEnv()
  configureLogger(env.LOG_LEVEL)
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

/**
 * One tenant session: `app.tenant_id` for this transaction, and `tenant_id`
 * on log lines inside `run`. The caller passes the kernel's `TenantContext`,
 * not a raw id. The SQL lives in the adapter.
 */
export async function openTenantSession<T>(
  transaction: TenantTransaction,
  context: TenantContext,
  run: () => Promise<T>,
): Promise<T> {
  const { openTenantSession: open } = await import('./infrastructure')
  return open(transaction, context, run)
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
