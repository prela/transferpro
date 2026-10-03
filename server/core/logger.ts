import type { Writable } from 'node:stream'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import pino from 'pino'
import { z } from 'zod'

/**
 * Shown in place of a redacted value. The test treats this literal as the
 * proof that the field did not reach the line.
 */
const REDACTED = '[Redacted]'

export const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const
export type LogLevel = (typeof logLevels)[number]

/**
 * Personal-data keys, compared after lowercasing and stripping `_` and `-`.
 * Exact match only: a substring would also hide `username` or `hostname`.
 * `user_id` is absent on purpose. The charter allows that opaque id.
 */
const PERSONAL_KEYS = new Set([
  'name',
  'firstname',
  'lastname',
  'fullname',
  'guestname',
  'passengername',
  'displayname',
  'email',
  'emailaddress',
  'phone',
  'phonenumber',
  'mobile',
  'telephone',
  'flight',
  'flightnumber',
  'flightno',
  'address',
  'street',
  'streetaddress',
  'postalcode',
  'zipcode',
  'price',
  'prices',
  'fare',
  'note',
  'notes',
  // Postgres `detail` carries the row values that caused the error.
  'detail',
  'connectionstring',
])

/**
 * Secret keys match when the normalized name contains one of these.
 * `BETTER_AUTH_SECRET` and `AUTH_DATABASE_URL` are caught that way.
 */
const SECRET_PARTS = ['secret', 'token', 'password', 'cookie', 'authorization', 'apikey', 'databaseurl']

/**
 * An invitation id is a bearer secret (ADR-0013). The link keeps it in the
 * hash, and these keys are redacted whole. A URL in any other string is
 * scrubbed below, including a log message: ADR-0012 does not scan messages
 * for personal data, and this pattern is the exception.
 */
const INVITE_BEARER_KEYS = new Set(['invitationid', 'inviteurl'])

function scrubInviteBearer(value: string): string {
  // A fresh regex each call: a shared /g pattern would keep lastIndex.
  return value.replace(
    /(invitationId=|accept-invite[#/])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '$1[Redacted]',
  )
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll('_', '').replaceAll('-', '')
}

function isRedactedKey(key: string, parentKey?: string): boolean {
  const normalized = normalizeKey(key)
  if (PERSONAL_KEYS.has(normalized) || INVITE_BEARER_KEYS.has(normalized))
    return true
  // `{ invitation: { id } }` is the bearer, not a user id.
  if (parentKey !== undefined && normalizeKey(parentKey) === 'invitation' && normalized === 'id')
    return true
  return SECRET_PARTS.some(part => normalized.includes(part))
}

/**
 * Walks the payload. Pino's path redaction matches one level, and a
 * passenger name sits under `passenger.name`.
 */
function redact(value: unknown, parentKey?: string): unknown {
  // `name` is a person's name. An Error's name is its type, so the log
  // field is `type`. Enumerable extras (Postgres `detail`) stay on the
  // object and go through the same key list. `message` and `stack` are
  // not scanned: do not interpolate personal data into them.
  if (value instanceof Error) {
    const fields: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value))
      fields[key] = child
    delete fields.name
    fields.type = value.name
    fields.message = value.message
    fields.stack = value.stack
    return redact(fields, parentKey)
  }

  if (Array.isArray(value))
    return value.map(item => redact(item, parentKey))

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value))
      out[key] = isRedactedKey(key, parentKey) ? REDACTED : redact(child, key)
    return out
  }

  if (typeof value === 'string')
    return scrubInviteBearer(value)

  return value
}

/**
 * Header value we will store and send back. Letters, digits, `.`, `_`, `-`.
 * Anything else (a newline, an email, a space) is rejected so it cannot
 * break the JSON line or put personal data into `request_id`.
 */
const requestIdSchema = z.string().regex(/^\w[\w.-]{0,127}$/)

/** A header or stored id we are willing to put on a log line. Unsafe values are dropped. */
export function acceptRequestId(header: string | undefined): string | undefined {
  const parsed = requestIdSchema.safeParse(header)
  return parsed.success ? parsed.data : undefined
}

export function resolveRequestId(header: string | undefined): string {
  return acceptRequestId(header) ?? randomUUID()
}

interface LogScope {
  request_id?: string
  tenant_id?: string
}

const logScope = new AsyncLocalStorage<LogScope>()

/** Lines written inside `fn` carry this request id. Lines outside do not. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return logScope.run({ request_id: requestId }, fn)
}

/**
 * Binds the request id for the rest of this async call, including work
 * Nitro runs after the request hook returns. Does not copy a tenant id:
 * a new request has not opened a tenant session yet.
 */
export function openRequestLog(header: string | undefined): string {
  const requestId = resolveRequestId(header)
  logScope.enterWith({ request_id: requestId })
  return requestId
}

/** Drops the request scope. Tests call this; a finished request ends on its own. */
export function endRequestLog(): void {
  logScope.enterWith({})
}

let configured: Logger | undefined

/** Called from boot so every later `getLogger()` uses the env level. */
export function configureLogger(level: LogLevel): Logger {
  configured ??= createLogger({ level })
  return configured
}

export function getLogger(): Logger {
  if (!configured)
    throw new Error('Logger is not configured. boot() must run first.')
  return configured
}

/** The request id bound by `openRequestLog`, if this call is inside a request. */
export function currentRequestId(): string | undefined {
  return logScope.getStore()?.request_id
}

/**
 * Lines written inside `fn` carry this tenant id. The request id already
 * on the scope stays. After `fn` returns, the tenant id is gone again:
 * a line outside the tenant call must not invent one.
 */
export function runWithTenantId<T>(tenantId: string, fn: () => T): T {
  const parent = logScope.getStore()
  return logScope.run({ ...parent, tenant_id: tenantId }, fn)
}

function bindings(): Record<string, string> {
  const store = logScope.getStore()
  if (!store)
    return {}
  const out: Record<string, string> = {}
  if (store.request_id)
    out.request_id = store.request_id
  if (store.tenant_id)
    out.tenant_id = store.tenant_id
  return out
}

type LogMethod = (obj: Record<string, unknown>, msg?: string) => void

export interface Logger {
  fatal: LogMethod
  error: LogMethod
  warn: LogMethod
  info: LogMethod
  debug: LogMethod
  trace: LogMethod
}

export function createLogger(options: { level: LogLevel, destination?: Writable }): Logger {
  const logger = pino({
    level: options.level,
    // Read at write time, so a line sees the scope that is active then.
    mixin: bindings,
    // Pino's default `err` serializer runs after redact and would replace
    // our `{ type, stack }` with `constructor.name` (`Object`).
    serializers: {
      err(err) {
        return err
      },
    },
  }, options.destination ?? process.stdout)

  function write(level: LogLevel, obj: Record<string, unknown>, msg?: string) {
    // Scope fields come from the async context only. A payload key of the
    // same name must not invent a request or a tenant.
    const { request_id: _requestId, tenant_id: _tenantId, ...payload } = redact(obj) as Record<string, unknown>
    if (msg === undefined)
      logger[level](payload)
    else
      logger[level](payload, scrubInviteBearer(msg))
  }

  return {
    fatal: (obj, msg) => write('fatal', obj, msg),
    error: (obj, msg) => write('error', obj, msg),
    warn: (obj, msg) => write('warn', obj, msg),
    info: (obj, msg) => write('info', obj, msg),
    debug: (obj, msg) => write('debug', obj, msg),
    trace: (obj, msg) => write('trace', obj, msg),
  }
}

const GENERIC_STATUS_MESSAGE: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
}

export interface ClientErrorBody {
  readonly statusCode: number
  readonly message: string
  readonly request_id: string
}

function statusCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode
    if (typeof code === 'number' && Number.isInteger(code) && code >= 400 && code <= 599)
      return code
  }
  return 500
}

function genericMessage(statusCode: number): string {
  return GENERIC_STATUS_MESSAGE[statusCode] ?? (statusCode >= 500 ? 'Internal Server Error' : 'Request failed')
}

/**
 * One log line with type and stack, then a body of three fields.
 * The thrown message is not copied: Nitro's default handler would send
 * it, and in development the stack as well.
 */
export function handleLoggedError(logger: Logger, error: unknown, requestId: string | undefined): ClientErrorBody {
  const err = error instanceof Error ? error : new Error('Non-error rejection')
  logger.error({ err })
  const statusCode = statusCodeOf(error)
  return {
    statusCode,
    message: genericMessage(statusCode),
    request_id: requestId ?? '',
  }
}
