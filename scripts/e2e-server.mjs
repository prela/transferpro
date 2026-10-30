import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { assertE2eDatabaseEnv, E2E_APP_DATABASE_ENV } from './e2e-database.mjs'

/**
 * Playwright starts the built app through this script.
 * The server must be the test mailer: NODE_ENV=test and no Resend key.
 * A set key would select Resend if the app forgot the test branch
 * while MAILER=resend.
 */
const key = process.env.RESEND_API_KEY
if (process.env.NODE_ENV !== 'test' || (key !== undefined && key !== '')) {
  console.error('E2E refused to start: the Resend transport must not be active. NODE_ENV must be test and RESEND_API_KEY must be unset.')
  process.exit(1)
}

try {
  assertE2eDatabaseEnv(process.env, E2E_APP_DATABASE_ENV)
  if (process.env.DATABASE_MIGRATE_URL !== undefined && process.env.DATABASE_MIGRATE_URL !== '')
    assertE2eDatabaseEnv(process.env, ['DATABASE_MIGRATE_URL'])
}
catch (error) {
  console.error(error instanceof Error ? error.message : 'E2E refused to start.')
  process.exit(1)
}

// The owner URL migrates and seeds. The app process must not see it.
delete process.env.DATABASE_MIGRATE_URL

// E2E never calls the current tool (ADR-0051). The key exists only so an
// Admin can store a token during the settings spec. It is not a Tenant secret.
process.env.INVOICING = 'fake'
if (process.env.INVOICING_SECRET_KEY === undefined || process.env.INVOICING_SECRET_KEY === '')
  process.env.INVOICING_SECRET_KEY = Buffer.alloc(32, 7).toString('base64')

// A previous run can leave a token. The spec must see only this server's mail.
const resetOutbox = process.env.E2E_PASSWORD_RESET_OUTBOX
if (resetOutbox !== undefined && resetOutbox !== '')
  writeFileSync(resetOutbox, '')

const child = spawn(process.execPath, ['.output/server/index.mjs'], {
  stdio: 'inherit',
  env: process.env,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

child.on('exit', (code, signal) => {
  if (signal)
    process.exit(1)
  process.exit(code ?? 1)
})
