import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'vitest'
import { assertRlsDatabaseEnv } from './rls-database.mjs'

const ready = {
  DATABASE_URL: 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro_e2e',
  AUTH_DATABASE_URL: 'postgres://transferpro_auth:auth-secret@localhost:5432/transferpro_e2e',
  QUEUE_DATABASE_URL: 'postgres://transferpro_queue:queue-secret@127.0.0.1:5432/transferpro_e2e',
  PLATFORM_DATABASE_URL: 'postgres://transferpro_platform:platform-secret@127.0.0.1:5432/transferpro_e2e',
  DATABASE_MIGRATE_URL: 'postgres://transferpro_owner:owner-secret@127.0.0.1:5432/transferpro_e2e?sslmode=disable',
}

it('refuses to start rls against the dev database and does not echo the secret', () => {
  const env = {
    ...ready,
    DATABASE_URL: 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro',
  }
  assert.throws(() => assertRlsDatabaseEnv(env), (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /RLS refused to start: DATABASE_URL /)
    assert.match(error.message, /transferpro_e2e/)
    assert.equal(error.message.includes('app-secret'), false)
    assert.equal(error.message.includes('postgres://'), false)
    return true
  })
})

it('starts when every suite URL names transferpro_e2e', () => {
  assert.doesNotThrow(() => assertRlsDatabaseEnv(ready))
})

it('refuses a migrate URL that still names the dev database', () => {
  const env = {
    ...ready,
    DATABASE_MIGRATE_URL: 'postgres://transferpro_owner:owner-secret@127.0.0.1:5432/transferpro',
  }
  assert.throws(() => assertRlsDatabaseEnv(env), (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /DATABASE_MIGRATE_URL/)
    assert.equal(error.message.includes('owner-secret'), false)
    return true
  })
})

it('refuses host and hostaddr query keys and does not echo the URL', () => {
  const url = 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro_e2e?host=db.example'
  assert.throws(() => assertRlsDatabaseEnv({ ...ready, DATABASE_URL: url }), (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /^RLS refused to start: DATABASE_URL /)
    assert.equal(error.message.includes(url), false)
    assert.equal(error.message.includes('db.example'), false)
    assert.equal(error.message.includes('app-secret'), false)
    return true
  })
})

it('the preflight exits before vitest when DATABASE_URL names transferpro', () => {
  const env = { ...process.env }
  for (const [name, value] of Object.entries(ready))
    env[name] = value.replace('/transferpro_e2e', '/transferpro')
  // The fast CI job checks out the repo and has no .env. The refusal has to
  // come from the database name, which this env already sets.
  const cwd = mkdtempSync(join(tmpdir(), 'rls-preflight-'))
  const result = spawnSync(process.execPath, [join(process.cwd(), 'scripts/assert-rls-database.mjs')], {
    encoding: 'utf8',
    env,
    cwd,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /RLS refused to start: DATABASE_URL /)
  assert.match(result.stderr, /transferpro_e2e/)
  assert.equal(result.stderr.includes('app-secret'), false)
  assert.equal(result.stdout.includes('RUN'), false)
})
