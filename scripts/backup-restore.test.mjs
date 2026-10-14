/**
 * Disposable Postgres 18. Not part of `pnpm test`: the fast CI job has no Docker.
 * The slow job runs this file with vitest.backup.config.ts.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { it } from 'vitest'
import { startFakeBackupBucket } from './fake-backup-bucket.mjs'

const container = 'transferpro-backup-234'

it('restores an encrypted dump into an isolated database', { timeout: 300_000 }, async () => {
  const secrets = [
    randomBytes(18).toString('hex'),
    randomBytes(18).toString('hex'),
    randomBytes(18).toString('hex'),
    randomBytes(18).toString('hex'),
    randomBytes(18).toString('hex'),
    randomBytes(18).toString('hex'),
  ]
  const [owner, app, auth, queue, platform, passphrase] = secrets
  const bucket = await startFakeBackupBucket()
  await runChecked('docker', ['rm', '-f', container], secrets)
  await runChecked('docker', [
    'run',
    '-d',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_DB=transferpro',
    '-p',
    '127.0.0.1::5432',
    'postgres:18',
  ], secrets)

  try {
    await waitUntilReady()
    const mapped = await runChecked('docker', ['port', container, '5432/tcp'], secrets)
    const port = mapped.stdout.trim().split(':').at(-1)
    if (!port)
      throw new Error('disposable Postgres did not publish a port')

    await runChecked('docker', [
      'run',
      '--rm',
      '--network',
      `container:${container}`,
      '--entrypoint',
      'bash',
      '-e',
      'PGHOST=127.0.0.1',
      '-e',
      'PGPORT=5432',
      '-e',
      'PGPASSWORD=postgres',
      '-e',
      'POSTGRES_USER=postgres',
      '-e',
      'POSTGRES_DB=transferpro',
      '-e',
      `TRANSFERPRO_OWNER_PASSWORD=${owner}`,
      '-e',
      `TRANSFERPRO_APP_PASSWORD=${app}`,
      '-e',
      `TRANSFERPRO_AUTH_PASSWORD=${auth}`,
      '-e',
      `TRANSFERPRO_QUEUE_PASSWORD=${queue}`,
      '-e',
      `TRANSFERPRO_PLATFORM_PASSWORD=${platform}`,
      '-v',
      `${process.cwd()}/docker/postgres/init-roles.sh:/init-roles.sh:ro`,
      'postgres:18',
      '/init-roles.sh',
    ], secrets)

    const source = `postgres://postgres:postgres@127.0.0.1:${port}/transferpro`
    const restore = `postgres://postgres:postgres@127.0.0.1:${port}/transferpro_restore_234`
    const appUrl = `postgres://transferpro_app:${app}@127.0.0.1:${port}/transferpro_restore_234`
    const ownerUrl = `postgres://transferpro_owner:${owner}@127.0.0.1:${port}/transferpro`

    await runChecked(process.execPath, ['./node_modules/drizzle-kit/bin.cjs', 'migrate'], secrets, {
      DATABASE_MIGRATE_URL: ownerUrl,
    })
    await runChecked('docker', [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      'create database transferpro_restore_234',
    ], secrets)

    const backup = await run('bash', ['scripts/backup-database.sh'], scriptEnv({
      BACKUP_DATABASE_URL: source,
      BACKUP_GPG_PASSPHRASE: passphrase,
      BACKUP_S3_BUCKET: 'transferpro',
      BACKUP_S3_ENDPOINT: bucket.url,
      BACKUP_S3_REGION: 'auto',
      BACKUP_S3_ALLOW_HTTP: '1',
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      BACKUP_PG_DOCKER_IMAGE: 'postgres:18',
    }))
    assert.equal(backup.code, 0, scrub(`${backup.stdout}\n${backup.stderr}`, secrets))
    assert.match(backup.stdout, /backup_key=daily\/\d{8}T\d{6}Z\.dump\.gpg/)

    const restored = await run('bash', ['scripts/restore-database.sh'], scriptEnv({
      BACKUP_DATABASE_URL: source,
      RESTORE_DATABASE_URL: restore,
      RESTORE_APP_DATABASE_URL: appUrl,
      BACKUP_GPG_PASSPHRASE: passphrase,
      BACKUP_S3_BUCKET: 'transferpro',
      BACKUP_S3_ENDPOINT: bucket.url,
      BACKUP_S3_REGION: 'auto',
      BACKUP_S3_ALLOW_HTTP: '1',
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      BACKUP_PG_DOCKER_IMAGE: 'postgres:18',
    }))
    assert.equal(restored.code, 0, scrub(`${restored.stdout}\n${restored.stderr}`, secrets))
    const seconds = restored.stdout.match(/restore_seconds=(\d+)/)
    assert.ok(seconds)
    process.stdout.write(`restore_seconds=${seconds[1]}\n`)
  }
  finally {
    await bucket.close()
    await run('docker', ['rm', '-f', container], { PATH: process.env.PATH })
  }
})

function scriptEnv(extra) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...extra,
  }
}

// The image's temporary init server has no TCP listener. A socket check can
// pass during that window, then the real server replaces it and the next
// connection is refused. TCP is up only after that replacement.
async function waitUntilReady() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const result = await run('docker', [
      'exec',
      container,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-p',
      '5432',
      '-U',
      'postgres',
      '-d',
      'transferpro',
    ], { PATH: process.env.PATH })
    if (result.code === 0)
      return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('disposable Postgres did not become ready')
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string[]} secrets
 * @param {NodeJS.ProcessEnv} [extra]
 */
async function runChecked(command, args, secrets, extra = {}) {
  const result = await run(command, args, {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...extra,
  })
  if (result.code !== 0) {
    throw new Error(scrub(`${command} failed\n${result.stdout}\n${result.stderr}`, secrets))
  }
  return result
}

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

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string[]} secrets
 */
/**
 * @param {string} text
 * @param {Array<string | undefined>} secrets
 */
function scrub(text, secrets) {
  let out = text
  for (const secret of secrets) {
    if (secret)
      out = out.replaceAll(secret, '[redacted]')
  }
  return out
}
