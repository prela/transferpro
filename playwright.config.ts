import process, { loadEnvFile } from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { applyE2eDatabaseEnv } from './scripts/e2e-database.mjs'
import { e2ePasswordResetOutboxPath } from './scripts/e2e-reset-outbox.mjs'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

// In memory only. `.env` still names the dev database `transferpro`.
applyE2eDatabaseEnv(process.env)

/**
 * Default port 3000. `E2E_PORT` is the escape hatch when `pnpm dev` already
 * holds 3000: the harness must not attach to that process, because it loads
 * the Resend key.
 */
const port = process.env.E2E_PORT ?? '3000'
const baseURL = `http://127.0.0.1:${port}`

/**
 * The built server inherits this env. The Resend key is omitted on purpose:
 * `scripts/e2e-server.mjs` exits if it is present, and the app selects the
 * fake mailer when NODE_ENV is test. `DATABASE_MIGRATE_URL` is the owner
 * role on `transferpro_e2e`. `e2e/prepare-database.ts` uses it to migrate. `e2e-server.mjs`
 * deletes it before the app starts. The Playwright worker keeps it for
 * seeding. `BETTER_AUTH_URL` matches the URL the browser uses, so the
 * session cookie is for this server.
 */
function e2eServerEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name === 'RESEND_API_KEY')
      continue
    env[name] = value
  }
  env.NODE_ENV = 'test'
  // MAPS and the Embed key stay as the developer env left them. The test
  // server uses the fake adapter, which yields an Embed URL without calling
  // Google (ADR-0052). Forcing MAPS here would change every spec.
  env.HOST = '127.0.0.1'
  env.PORT = port
  env.BETTER_AUTH_URL = baseURL
  env.E2E_PASSWORD_RESET_OUTBOX = e2ePasswordResetOutboxPath
  // Playwright merges this object over the parent env, so omitting a key
  // would leave the parent's value in place. Empty clears the Resend key.
  env.RESEND_API_KEY = ''
  return env
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  // CI shards the suite. Each shard writes blob-report/report-<n>.zip (the
  // shard index is part of the file name) and a later job merges those zips.
  // A local run keeps the html reporter and still runs every project.
  reporter: process.env.CI
    ? [['list'], ['blob']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'hr-HR',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Phone checks for steps 10–12. Only specs tagged @phone run here.
    // The desktop project stays the full suite.
    {
      name: 'phone',
      grep: /@phone/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'node --import ./scripts/register-ts.mjs ./e2e/prepare-database.ts && node ./scripts/e2e-server.mjs',
    url: baseURL,
    // Never reuse whatever is already listening. A local `pnpm dev` has the
    // Resend key, and attaching to it would send real mail.
    reuseExistingServer: false,
    timeout: 120_000,
    env: e2eServerEnv(),
  },
})
