import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { it } from 'vitest'
import { assertIsolatedRestore, databaseIdentity } from './backup-target.mjs'

it('treats localhost and 127.0.0.1 as the same source database', () => {
  const source = 'postgres://postgres:source-secret@localhost:5432/transferpro'
  const target = 'postgres://postgres:other-secret@127.0.0.1:5432/transferpro'
  assert.throws(() => assertIsolatedRestore(source, target), /source database/)
  assert.equal(databaseIdentity(source).host, '127.0.0.1')
})

it('allows a different database name on the same host', () => {
  assert.doesNotThrow(() => assertIsolatedRestore(
    'postgres://postgres:source-secret@127.0.0.1:5432/transferpro',
    'postgres://postgres:other-secret@127.0.0.1:5432/transferpro_restore',
  ))
})

it('allows the same database name on another host', () => {
  assert.doesNotThrow(() => assertIsolatedRestore(
    'postgres://postgres:source-secret@preview.internal:5432/transferpro',
    'postgres://postgres:other-secret@restore.internal:5432/transferpro',
  ))
})

it('does not echo the password when the URL is rejected', () => {
  assert.throws(
    () => databaseIdentity('postgres://postgres:super-secret-password@127.0.0.1:5432/'),
    (error) => {
      assert.equal(error instanceof Error, true)
      assert.equal(String(error.message).includes('super-secret-password'), false)
      return true
    },
  )
})

it('restore script refuses the source database before it downloads', async () => {
  const result = await run('bash', ['scripts/restore-database.sh'], {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    BACKUP_DATABASE_URL: 'postgres://postgres:source-secret@localhost:5432/transferpro',
    RESTORE_DATABASE_URL: 'postgres://postgres:other-secret@127.0.0.1:5432/transferpro',
    RESTORE_APP_DATABASE_URL: 'postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro',
    BACKUP_GPG_PASSPHRASE: 'test-passphrase',
    BACKUP_S3_BUCKET: 'bucket',
    BACKUP_S3_ENDPOINT: 'https://example.invalid',
    AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  })
  const output = `${result.stdout}\n${result.stderr}`
  assert.notEqual(result.code, 0)
  assert.match(output, /source database/)
  assert.equal(output.includes('source-secret'), false)
  assert.equal(output.includes('other-secret'), false)
  assert.equal(output.includes('test-passphrase'), false)
})

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}
