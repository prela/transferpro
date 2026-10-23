/**
 * e2e talks only to the database `transferpro_e2e` on localhost, or on the
 * GitHub Actions service host `postgres` when the e2e job runs in a container.
 * The dev database `transferpro` stays untouched, including audit rows
 * left behind by older runs. Any other host is refused, so this never
 * rewrites a production URL.
 *
 * node-pg copies query keys onto the config after the host in the URL.
 * `postgres://u:p@127.0.0.1/transferpro_e2e?host=prod.example` connects
 * to prod.example. `hostaddr` does the same. Only `sslmode` is allowed,
 * on the URL we were given and on the URL after the database rename.
 */
import { z } from 'zod'
import { databaseIdentity } from './backup-target.mjs'

export const E2E_DATABASE_NAME = 'transferpro_e2e'

/** The app process. The owner URL is for migrate and seed, not the server. */
export const E2E_APP_DATABASE_ENV = [
  'DATABASE_URL',
  'AUTH_DATABASE_URL',
  'QUEUE_DATABASE_URL',
  'PLATFORM_DATABASE_URL',
]

const E2E_DATABASE_ENV = [...E2E_APP_DATABASE_ENV, 'DATABASE_MIGRATE_URL']

/**
 * `databaseIdentity` already maps the hostname `localhost` to `127.0.0.1`.
 * `postgres` is the service label in `.github/workflows/ci.yml`. A longer
 * name such as `postgres.example` is a remote host and is refused.
 *
 * @param {string} host
 */
function isE2eDatabaseHost(host) {
  return host === '127.0.0.1' || host === 'postgres'
}

/**
 * node-pg prefers query keys over the host written in the URL.
 * The message names `name` and never includes the URL.
 *
 * @param {string} raw
 * @param {string} name
 */
function assertE2eQuery(raw, name) {
  let url
  try {
    url = new URL(raw)
  }
  catch {
    throw new Error(`E2E refused to start: ${name} is not a valid database URL.`)
  }
  for (const key of url.searchParams.keys()) {
    if (key !== 'sslmode')
      throw new Error(`E2E refused to start: ${name} may only set sslmode.`)
  }
}

/**
 * @param {string} raw
 * @param {string} name Env variable. Errors name it and never the URL.
 * @returns {string} Same URL, with the database name replaced. The secret stays.
 */
export function e2eDatabaseUrl(raw, name) {
  assertE2eQuery(raw, name)
  const identity = databaseIdentity(raw)
  if (!isE2eDatabaseHost(identity.host))
    throw new Error('E2E refused to start: the database host must be localhost.')
  const rewritten = raw.replace(
    /^(postgres(?:ql)?:\/\/[^/?#]+)\/[^/?#]*/,
    `$1/${E2E_DATABASE_NAME}`,
  )
  assertE2eQuery(rewritten, name)
  const checked = databaseIdentity(rewritten)
  if (!isE2eDatabaseHost(checked.host) || checked.database !== E2E_DATABASE_NAME)
    throw new Error(`E2E refused to start: the database must be ${E2E_DATABASE_NAME} on localhost.`)
  return rewritten
}

/**
 * Point every e2e connection at `transferpro_e2e`. Does not write `.env`.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function applyE2eDatabaseEnv(env) {
  for (const name of E2E_DATABASE_ENV) {
    const value = env[name]
    if (value === undefined || value === '')
      throw new Error(`E2E refused to start: ${name} is required.`)
    env[name] = e2eDatabaseUrl(value, name)
  }
}

const adminLoginSchema = z.object({
  user: z.string().regex(/^[a-z_]\w{0,62}$/i),
  // A newline would break the URL. The error below does not repeat the value.
  password: z.string().min(1).refine(value => !/[\r\n]/.test(value)),
})

/**
 * Maintenance login for creating `transferpro_e2e`. Defaults match local
 * Docker and CI. A bad value is refused without echoing the password.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ user: string, password: string }} Login for the maintenance database.
 */
export function e2eAdminLogin(env) {
  const parsed = adminLoginSchema.safeParse({
    user: env.E2E_ADMIN_USER || 'postgres',
    password: env.E2E_ADMIN_PASSWORD || 'postgres',
  })
  if (!parsed.success)
    throw new Error('E2E refused to start: the maintenance login is not valid.')
  return parsed.data
}

/**
 * Refuse to start unless every named URL is `transferpro_e2e` on localhost
 * or the CI service host `postgres`.
 * The message names the variable, never the URL, so a secret is not printed.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {readonly string[]} [names]
 */
export function assertE2eDatabaseEnv(env, names = E2E_DATABASE_ENV) {
  for (const name of names) {
    const value = env[name]
    if (value === undefined || value === '')
      throw new Error(`E2E refused to start: ${name} is required.`)
    assertE2eQuery(value, name)
    let identity
    try {
      identity = databaseIdentity(value)
    }
    catch {
      throw new Error(`E2E refused to start: ${name} is not a valid database URL.`)
    }
    if (!isE2eDatabaseHost(identity.host))
      throw new Error(`E2E refused to start: ${name} must target localhost.`)
    if (identity.database !== E2E_DATABASE_NAME)
      throw new Error(`E2E refused to start: ${name} must use the database ${E2E_DATABASE_NAME}.`)
  }
}
