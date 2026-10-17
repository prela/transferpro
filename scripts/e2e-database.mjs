/**
 * e2e talks only to the database `transferpro_e2e` on localhost.
 * The dev database `transferpro` stays untouched, including audit rows
 * left behind by older runs. A remote host is refused, so this never
 * rewrites a production URL.
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
 * @param {string} raw
 * @returns {string} Same URL, with the database name replaced. The secret stays.
 */
export function e2eDatabaseUrl(raw) {
  const identity = databaseIdentity(raw)
  if (identity.host !== '127.0.0.1')
    throw new Error('E2E refused to start: the database host must be localhost.')
  const rewritten = raw.replace(
    /^(postgres(?:ql)?:\/\/[^/?#]+)\/[^/?#]*/,
    `$1/${E2E_DATABASE_NAME}`,
  )
  const checked = databaseIdentity(rewritten)
  if (checked.host !== '127.0.0.1' || checked.database !== E2E_DATABASE_NAME)
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
    env[name] = e2eDatabaseUrl(value)
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
 * Refuse to start unless every named URL is `transferpro_e2e` on localhost.
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
    let identity
    try {
      identity = databaseIdentity(value)
    }
    catch {
      throw new Error(`E2E refused to start: ${name} is not a valid database URL.`)
    }
    if (identity.host !== '127.0.0.1')
      throw new Error(`E2E refused to start: ${name} must target localhost.`)
    if (identity.database !== E2E_DATABASE_NAME)
      throw new Error(`E2E refused to start: ${name} must use the database ${E2E_DATABASE_NAME}.`)
  }
}
