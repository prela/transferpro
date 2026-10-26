/**
 * Loads the demo seed environment, then runs the seed.
 * `.env.seed` is optional and last, so a preview file can replace the
 * local database URLs. A later `--env-file` overrides an earlier one.
 * A name already set in the shell still wins.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

const args = [
  '--import',
  './scripts/register-ts.mjs',
  '--env-file=.env',
  '--env-file=.env.migrate',
]
if (existsSync('.env.seed'))
  args.push('--env-file=.env.seed')
args.push('./scripts/demo-seed.ts')

const child = spawn(process.execPath, args, { stdio: 'inherit' })
child.on('error', () => {
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
