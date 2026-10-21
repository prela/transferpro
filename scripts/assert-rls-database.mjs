/**
 * Entry check for `pnpm test:rls`. Exits before vitest when a URL names
 * any database other than `transferpro_e2e`.
 */
import process from 'node:process'
import { assertLoadedRlsDatabaseEnv } from './rls-database.mjs'

try {
  assertLoadedRlsDatabaseEnv()
}
catch (error) {
  const message = error instanceof Error ? error.message : 'RLS refused to start.'
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
