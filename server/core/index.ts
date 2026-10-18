/**
 * Kernel entry. No Drizzle, pg-boss, or Nuxt.
 * Application code enqueues here. The adapter lives in infrastructure.ts.
 * Env is parsed here so boot can reject a bad config before that adapter loads.
 */
import type { LogLevel } from './logger'
import process from 'node:process'
import { z } from 'zod'
import { configureLogger, logLevels } from './logger'
import { guardReadiness } from './readiness'

export { hideDatabaseError, postgresErrorCode } from './database-error'
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
   * Which transport `mailerForApp` may select. Production is `resend`
   * unless a deployment sets `ALLOW_CONSOLE_MAILER=1` and `MAILER=console`
   * (ADR-0037). Preview uses `resend` plus `MAIL_ALLOWLIST` (ADR-0042).
   * Local and test leave this unset unless the operator opts in.
   */
  readonly MAILER: 'resend' | 'console' | undefined
  /**
   * Resend API key. Required in production together with `MAILER=resend`.
   * Omitted when the console mailer is selected. Optional in development
   * and test so `pnpm dev` does not share the daily quota.
   * The name is redacted (`apikey`). ADR-0013, ADR-0037.
   */
  readonly RESEND_API_KEY: string | undefined
  /**
   * Addresses that may reach Resend, lowercased. Unset means the selected
   * transport is unchanged. A set list sends everyone else as the console
   * line. ADR-0042. Required when `DEPLOY_ENV` is `preview`.
   */
  readonly MAIL_ALLOWLIST: readonly string[] | undefined
  /**
   * Which deployment this process is. `preview` and `production` both keep
   * `NODE_ENV=production`; this field is how boot tells them apart.
   * Unset and blank stay unset, and then `MAIL_ALLOWLIST` is optional,
   * the same as an explicit `production`. Any other value fails boot.
   */
  readonly DEPLOY_ENV: 'preview' | 'production' | undefined
  /**
   * Which maps adapter runs. `none` is the default in every environment,
   * so a fresh process never calls the provider. `google` requires the key.
   * ADR-0031.
   */
  readonly MAPS: 'google' | 'none'
  /**
   * Places API key. Required only when `MAPS=google`. The name is redacted
   * (`apikey`). It never reaches the browser.
   */
  readonly MAPS_API_KEY: string | undefined
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
 * A deployment that wants the console transport in production. The flag is
 * the string `1` only. `true`, `yes`, and blank do not opt in, so a
 * production deploy cannot pick up a leftover truthy value. Preview does
 * not set this; it sends through Resend to `MAIL_ALLOWLIST` (ADR-0042).
 */
function consoleMailerAllowed(source: NodeJS.ProcessEnv): boolean {
  return source.ALLOW_CONSOLE_MAILER === '1'
}

/**
 * Unset and blank are unset. `preview` and `production` are the only
 * other values. Zod parses the enum; a failure throws a fixed sentence
 * so the raw value is not written into the boot error.
 */
function parseDeployEnv(source: NodeJS.ProcessEnv): 'preview' | 'production' | undefined {
  const raw = blankEnv(source.DEPLOY_ENV)
  if (raw === undefined)
    return undefined
  const parsed = z.enum(['preview', 'production']).safeParse(raw)
  if (!parsed.success)
    throw new Error('DEPLOY_ENV must be preview, production, or unset.')
  return parsed.data
}

/**
 * Comma-separated emails. Blank and unset leave the transport alone.
 * Each entry is trimmed. A blank entry or a value Zod rejects as an email
 * fails boot. The thrown text is fixed so the value is not echoed.
 */
function parseMailAllowlist(source: NodeJS.ProcessEnv): readonly string[] | undefined {
  const raw = blankEnv(source.MAIL_ALLOWLIST)
  if (raw === undefined)
    return undefined
  const entries = raw.split(',').map(entry => entry.trim())
  const parsed = z.array(z.email()).safeParse(entries)
  if (!parsed.success)
    throw new Error('MAIL_ALLOWLIST has a blank or invalid email.')
  return parsed.data.map(entry => entry.toLowerCase())
}

/**
 * Production cannot boot without `MAILER=resend`, except the console
 * opt-in (ADR-0037). Anywhere else the value is optional: unset means
 * the console mailer in development and the fake mailer in test.
 */
function parseMailer(source: NodeJS.ProcessEnv): 'resend' | 'console' | undefined {
  const raw = blankEnv(source.MAILER)
  if (source.NODE_ENV === 'production') {
    if (consoleMailerAllowed(source) && raw === 'console')
      return 'console'
    return z.literal('resend').parse(raw)
  }
  if (raw === undefined)
    return undefined
  return z.enum(['resend', 'console']).parse(raw)
}

/**
 * Production cannot boot without a key, unless the console mailer was
 * explicitly allowed. Development and test omit it so a local process
 * does not send through the shared Resend quota. A blank value counts
 * as missing.
 */
function parseResendApiKey(
  source: NodeJS.ProcessEnv,
  mailer: 'resend' | 'console' | undefined,
): string | undefined {
  const key = blankEnv(source.RESEND_API_KEY)
  if (source.NODE_ENV === 'production' && mailer !== 'console')
    return resendKeySchema.parse(key)
  if (key === undefined)
    return undefined
  return resendKeySchema.parse(key)
}

/**
 * Unset or blank is `none` in every environment, including production.
 * `google` is the only other value. A typo fails boot.
 */
function parseMaps(source: NodeJS.ProcessEnv): 'google' | 'none' {
  const raw = blankEnv(source.MAPS)
  if (raw === undefined)
    return 'none'
  return z.enum(['google', 'none']).parse(raw)
}

/**
 * `MAPS=google` cannot boot without a key. A blank value counts as missing.
 * `none` may omit the key. The value is not copied into the error text.
 */
function parseMapsApiKey(source: NodeJS.ProcessEnv, maps: 'google' | 'none'): string | undefined {
  const key = blankEnv(source.MAPS_API_KEY)
  if (maps === 'google')
    return z.string().min(1).parse(key)
  if (key === undefined)
    return undefined
  return z.string().min(1).parse(key)
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
  const MAPS = parseMaps(source)
  const MAILER = parseMailer(source)
  const DEPLOY_ENV = parseDeployEnv(source)
  const MAIL_ALLOWLIST = parseMailAllowlist(source)
  // Preview cannot fall through to an open Resend path (ADR-0043).
  // Production and an unset deploy still boot without the list (ADR-0037, ADR-0042).
  if (DEPLOY_ENV === 'preview' && MAIL_ALLOWLIST === undefined)
    throw new Error('MAIL_ALLOWLIST is required when DEPLOY_ENV is preview.')
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
    MAILER,
    RESEND_API_KEY: parseResendApiKey(source, MAILER),
    MAIL_ALLOWLIST,
    DEPLOY_ENV,
    MAPS,
    MAPS_API_KEY: parseMapsApiKey(source, MAPS),
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
 * The runtime-role probe. Boot and readiness both use it. The adapter
 * stays behind this import so the kernel entry does not name the driver.
 */
async function loadRuntimeRoleCheck(): Promise<(env: AppEnv) => Promise<void>> {
  const { assertRuntimeRoles } = await import('./infrastructure')
  return assertRuntimeRoles
}

/**
 * Parse once, then refuse to start if the app, auth, queue, or platform
 * role is over-privileged. The privilege query lives in the adapter.
 */
export async function boot(): Promise<AppEnv> {
  const env = loadAppEnv()
  configureLogger(env.LOG_LEVEL)
  const assertRuntimeRoles = await loadRuntimeRoleCheck()
  await assertRuntimeRoles(env)
  return env
}

/**
 * Readiness, as opposed to boot. Boot stops the process. This answers one
 * HTTP check, including after the database has gone away. The same role
 * probe is used, so a URL that drifted onto the migrator still fails.
 */
export async function assertReady(env: AppEnv = loadAppEnv()): Promise<void> {
  const assertRuntimeRoles = await loadRuntimeRoleCheck()
  await guardReadiness(() => assertRuntimeRoles(env))
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

/** A recurring job. It is not one Tenant, and it carries no request id. */
export interface ScheduledJob {
  readonly id: string
  readonly name: string
  readonly data: unknown
}

export interface JobQueue {
  /**
   * Insert one job in `transaction`. A rollback of that transaction
   * removes the job. The tenant is `context.tenantId`, not a field of `data`.
   * The current request id, when one is open, is stored beside `tenantId`.
   * `startAfter` is the instant the worker may take the job. Without it, the job is due now.
   */
  enqueue: (
    context: TenantContext,
    transaction: TenantTransaction,
    name: string,
    data: unknown,
    options?: { readonly startAfter?: Date },
  ) => Promise<void>

  /**
   * Claim one waiting job and run `handle` inside a new tenant transaction.
   * The envelope's request id is restored before that session opens.
   * Null when the queue has nothing to take.
   */
  handleNext: (
    name: string,
    handle: (job: QueuedJob, scope: JobHandlerScope) => Promise<void>,
  ) => Promise<QueuedJob | null>

  /**
   * Recurring send on this same queue. No tenant and no request exist
   * at schedule time, so nothing is invented onto the stored payload.
   */
  schedule: (name: string, cron: string, data: unknown) => Promise<void>

  /**
   * Worker for `schedule`. No tenant session is opened.
   * `publish` enqueues one tenant job through the envelope path.
   */
  workScheduled: (
    name: string,
    handle: (
      job: ScheduledJob,
      publish: (tenantId: string, name: string, data: unknown) => Promise<void>,
    ) => Promise<void>,
  ) => Promise<void>

  /**
   * Worker for jobs from `enqueue` and `publish`. Restores the envelope's
   * request id, then opens the tenant session, then runs `handle`.
   */
  work: (
    name: string,
    handle: (job: QueuedJob, scope: JobHandlerScope) => Promise<void>,
  ) => Promise<void>

  close: () => Promise<void>
}
