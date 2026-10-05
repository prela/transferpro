import { spawn } from 'node:child_process'
import process from 'node:process'

/**
 * Playwright starts the built app through this script.
 * The server must be the test mailer: NODE_ENV=test and no Resend key.
 * A set key would select the real transport if the app forgot the test branch.
 */
const key = process.env.RESEND_API_KEY
if (process.env.NODE_ENV !== 'test' || (key !== undefined && key !== '')) {
  console.error('E2E refused to start: the Resend transport must not be active. NODE_ENV must be test and RESEND_API_KEY must be unset.')
  process.exit(1)
}

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
