import process, { loadEnvFile } from 'node:process'
import { defineConfig, devices } from '@playwright/test'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

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
 * fake mailer when NODE_ENV is test. `BETTER_AUTH_URL` matches the URL the
 * browser uses, so the session cookie is for this server.
 */
function e2eServerEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name === 'RESEND_API_KEY')
      continue
    env[name] = value
  }
  env.NODE_ENV = 'test'
  env.HOST = '127.0.0.1'
  env.PORT = port
  env.BETTER_AUTH_URL = baseURL
  // Playwright merges this object over the parent env, so omitting the key
  // would leave the parent's Resend key in place. Empty clears it.
  env.RESEND_API_KEY = ''
  return env
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'hr-HR',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node ./scripts/e2e-server.mjs',
    url: baseURL,
    // Never reuse whatever is already listening. A local `pnpm dev` has the
    // Resend key, and attaching to it would send real mail.
    reuseExistingServer: false,
    timeout: 120_000,
    env: e2eServerEnv(),
  },
})
