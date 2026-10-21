/**
 * Entry check for `pnpm test:rls`. Loads the same env files the suite
 * reads, then exits before vitest when a URL names any database other
 * than `transferpro_e2e`. An already-set variable wins, matching
 * `loadEnvFile` inside the tests.
 */
import process, { loadEnvFile } from 'node:process'
import { assertRlsDatabaseEnv } from './rls-database.mjs'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

try {
  assertRlsDatabaseEnv(process.env)
}
catch (error) {
  const message = error instanceof Error ? error.message : 'RLS refused to start.'
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
