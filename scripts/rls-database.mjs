/**
 * RLS talks only to the database `transferpro_e2e`.
 * The dev database `transferpro` is never a target: a wrong name exits
 * before vitest starts, so nothing connects. The message names the
 * variable and never the URL, so a secret is not printed.
 *
 * node-pg copies query keys onto the config after the host in the URL.
 * `postgres://u:p@127.0.0.1/transferpro_e2e?host=prod.example` connects
 * to prod.example. `hostaddr` does the same. Only `sslmode` is allowed.
 */
import { existsSync } from 'node:fs'
import process, { loadEnvFile } from 'node:process'
import { databaseIdentity } from './backup-target.mjs'

export const RLS_DATABASE_NAME = 'transferpro_e2e'

/** Every URL the RLS suite opens. One wrong name is enough to refuse. */
export const RLS_DATABASE_ENV = [
  'DATABASE_URL',
  'AUTH_DATABASE_URL',
  'QUEUE_DATABASE_URL',
  'PLATFORM_DATABASE_URL',
  'DATABASE_MIGRATE_URL',
]

/**
 * @param {string} raw
 * @param {string} name
 */
function assertRlsQuery(raw, name) {
  let url
  try {
    url = new URL(raw)
  }
  catch {
    throw new Error(`RLS refused to start: ${name} must name the database ${RLS_DATABASE_NAME}.`)
  }
  for (const key of url.searchParams.keys()) {
    if (key !== 'sslmode')
      throw new Error(`RLS refused to start: ${name} may only set sslmode.`)
  }
}

/**
 * Refuse to start unless every suite URL names `transferpro_e2e`.
 * Does not open a connection.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function assertRlsDatabaseEnv(env) {
  for (const name of RLS_DATABASE_ENV) {
    const value = env[name]
    if (value === undefined || value === '')
      throw new Error(`RLS refused to start: ${name} must name the database ${RLS_DATABASE_NAME}.`)
    assertRlsQuery(value, name)
    let identity
    try {
      identity = databaseIdentity(value)
    }
    catch {
      throw new Error(`RLS refused to start: ${name} must name the database ${RLS_DATABASE_NAME}.`)
    }
    if (identity.database !== RLS_DATABASE_NAME)
      throw new Error(`RLS refused to start: ${name} must name the database ${RLS_DATABASE_NAME}.`)
  }
}

/**
 * Load a suite env file when it is there. The fast CI job has neither file.
 * A missing file is not a refusal: the variables may already be in the environment.
 * `loadEnvFile` throws ENOENT, which would hide the database-name check.
 *
 * @param {string} path
 */
function loadSuiteEnvFile(path) {
  if (existsSync(path))
    loadEnvFile(path)
}

/**
 * Load the suite env files, then refuse a database other than `transferpro_e2e`.
 * An already-set variable wins, matching `loadEnvFile` inside the tests.
 * Does not open a connection.
 */
export function assertLoadedRlsDatabaseEnv() {
  loadSuiteEnvFile('.env')
  loadSuiteEnvFile('.env.migrate')
  assertRlsDatabaseEnv(process.env)
}
