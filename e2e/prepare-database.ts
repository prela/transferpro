/**
 * Create a fresh `transferpro_e2e` and migrate it before the e2e server listens.
 * The database is dropped at the start of each run, so test firms do not pile up.
 * This never connects to the dev database `transferpro`. Audit rows left there
 * by older e2e runs stay; the trigger that blocks deleting them is not touched.
 * AGENTS.md allows this drop only for `transferpro_e2e` on localhost.
 */
import { spawn } from 'node:child_process'
import process from 'node:process'
import pg from 'pg'
import { databaseIdentity } from '../scripts/backup-target.mjs'
import { assertE2eDatabaseEnv, E2E_DATABASE_NAME, e2eAdminLogin } from '../scripts/e2e-database.mjs'

if (E2E_DATABASE_NAME !== 'transferpro_e2e')
  fail('E2E refused to start: refusing to drop a database that is not transferpro_e2e.')

void prepare()

async function prepare(): Promise<void> {
  try {
    assertE2eDatabaseEnv(process.env)
    await recreate()
    await migrate()
  }
  catch (error) {
    fail(error instanceof Error ? error.message : 'E2E refused to start: preparing transferpro_e2e failed.')
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

async function recreate(): Promise<void> {
  const app = databaseIdentity(process.env.DATABASE_URL ?? '')
  const admin = e2eAdminLogin(process.env)
  const url = new URL('postgres://127.0.0.1')
  url.username = admin.user
  url.password = admin.password
  url.hostname = app.host
  url.port = app.port
  url.pathname = '/postgres'

  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 })
  try {
    const current = await pool.query<{ name: string }>('select current_database() as name')
    if (current.rows[0]?.name !== 'postgres')
      throw new Error('E2E refused to start: the maintenance connection is not the postgres database.')
    const name = quoteIdent(E2E_DATABASE_NAME)
    await pool.query(`drop database if exists ${name} with (force)`)
    await pool.query(`create database ${name}`)
    await pool.query(`grant connect on database ${name} to transferpro_owner, transferpro_app, transferpro_auth, transferpro_queue, transferpro_platform`)
    await pool.query(`grant create on database ${name} to transferpro_owner`)
  }
  finally {
    await pool.end()
  }
}

function migrate(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['./node_modules/drizzle-kit/bin.cjs', 'migrate'], {
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', () => {
      reject(new Error('E2E refused to start: migrating transferpro_e2e failed.'))
    })
    child.on('exit', (code) => {
      if (code === 0)
        resolve()
      else
        reject(new Error('E2E refused to start: migrating transferpro_e2e failed.'))
    })
  })
}

function quoteIdent(name: string): string {
  if (!/^[a-z_]\w*$/.test(name))
    throw new Error('E2E refused to start: the database name is not safe.')
  return `"${name}"`
}
