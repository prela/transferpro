import assert from 'node:assert/strict'
import { it } from 'vitest'
import { applyE2eDatabaseEnv, assertE2eDatabaseEnv, E2E_DATABASE_NAME, e2eAdminLogin, e2eDatabaseUrl } from './e2e-database.mjs'

const dev = {
  DATABASE_URL: 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro',
  AUTH_DATABASE_URL: 'postgres://transferpro_auth:auth-secret@localhost:5432/transferpro',
  QUEUE_DATABASE_URL: 'postgres://transferpro_queue:queue-secret@127.0.0.1:5432/transferpro',
  PLATFORM_DATABASE_URL: 'postgres://transferpro_platform:platform-secret@127.0.0.1:5432/transferpro',
  DATABASE_MIGRATE_URL: 'postgres://transferpro_owner:owner-secret@127.0.0.1:5432/transferpro?sslmode=disable',
}

it('rewrites a local dev database to the e2e database and keeps the secret', () => {
  const env = { ...dev }
  applyE2eDatabaseEnv(env)
  assert.equal(E2E_DATABASE_NAME, 'transferpro_e2e')
  assert.equal(env.DATABASE_URL, 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro_e2e')
  assert.equal(env.AUTH_DATABASE_URL, 'postgres://transferpro_auth:auth-secret@localhost:5432/transferpro_e2e')
  assert.equal(env.DATABASE_MIGRATE_URL, 'postgres://transferpro_owner:owner-secret@127.0.0.1:5432/transferpro_e2e?sslmode=disable')
  assert.equal(e2eDatabaseUrl(env.DATABASE_URL, 'DATABASE_URL'), env.DATABASE_URL)
  assert.doesNotThrow(() => assertE2eDatabaseEnv(env))
})

it('refuses to start e2e against the dev database and does not echo the secret', () => {
  assert.throws(() => assertE2eDatabaseEnv(dev), (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /transferpro_e2e/)
    assert.equal(error.message.includes('app-secret'), false)
    assert.equal(error.message.includes('owner-secret'), false)
    return true
  })
})

it('accepts the CI service host postgres and refuses a lookalike host', () => {
  const env = {
    ...dev,
    DATABASE_URL: 'postgres://transferpro_app:app-secret@postgres:5432/transferpro',
    AUTH_DATABASE_URL: 'postgres://transferpro_auth:auth-secret@postgres:5432/transferpro',
    QUEUE_DATABASE_URL: 'postgres://transferpro_queue:queue-secret@postgres:5432/transferpro',
    PLATFORM_DATABASE_URL: 'postgres://transferpro_platform:platform-secret@postgres:5432/transferpro',
    DATABASE_MIGRATE_URL: 'postgres://transferpro_owner:owner-secret@postgres:5432/transferpro',
  }
  applyE2eDatabaseEnv(env)
  assert.equal(env.DATABASE_URL, 'postgres://transferpro_app:app-secret@postgres:5432/transferpro_e2e')
  assert.equal(env.DATABASE_MIGRATE_URL, 'postgres://transferpro_owner:owner-secret@postgres:5432/transferpro_e2e')
  assert.doesNotThrow(() => assertE2eDatabaseEnv(env))

  const lookalike = {
    ...env,
    DATABASE_URL: 'postgres://transferpro_app:app-secret@postgres.example:5432/transferpro_e2e',
  }
  assert.throws(() => applyE2eDatabaseEnv(lookalike), (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /localhost/)
    assert.equal(error.message.includes('app-secret'), false)
    assert.equal(error.message.includes('postgres.example'), false)
    return true
  })
})

it('refuses a remote host even when the database is named transferpro_e2e', () => {
  const env = {
    ...dev,
    DATABASE_URL: 'postgres://transferpro_app:app-secret@db.example:5432/transferpro_e2e',
  }
  assert.throws(() => applyE2eDatabaseEnv(env), (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /localhost/)
    assert.equal(error.message.includes('app-secret'), false)
    return true
  })
})

it('refuses host and hostaddr query keys and does not echo the URL', () => {
  const local = 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro_e2e'
  const ready = { ...dev }
  applyE2eDatabaseEnv(ready)
  for (const query of ['host=db.example', 'hostaddr=10.0.0.1']) {
    const url = `${local}?${query}`
    const env = { ...ready, DATABASE_URL: url }
    for (const run of [applyE2eDatabaseEnv, assertE2eDatabaseEnv]) {
      assert.throws(() => run({ ...env }), (error) => {
        assert.equal(error instanceof Error, true)
        assert.match(error.message, /^E2E refused to start: DATABASE_URL /)
        assert.equal(error.message.includes(url), false)
        assert.equal(error.message.includes('db.example'), false)
        assert.equal(error.message.includes('10.0.0.1'), false)
        assert.equal(error.message.includes('app-secret'), false)
        return true
      })
    }
  }
})

it('allows a database URL whose only query key is sslmode', () => {
  const env = {
    ...dev,
    DATABASE_URL: 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro?sslmode=disable',
  }
  applyE2eDatabaseEnv(env)
  assert.equal(env.DATABASE_URL, 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro_e2e?sslmode=disable')
  assert.doesNotThrow(() => assertE2eDatabaseEnv(env))
})

it('refuses to start when a database URL is missing', () => {
  const env = { ...dev }
  delete env.QUEUE_DATABASE_URL
  assert.throws(() => applyE2eDatabaseEnv(env), /QUEUE_DATABASE_URL/)
})

it('uses the local maintenance login and does not echo a rejected password', () => {
  assert.deepEqual(e2eAdminLogin({}), { user: 'postgres', password: 'postgres' })
  assert.throws(() => e2eAdminLogin({ E2E_ADMIN_PASSWORD: 'line\nbreak' }), (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /maintenance login/)
    assert.equal(error.message.includes('line'), false)
    return true
  })
})
