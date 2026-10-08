/**
 * Feeds sample paths to the read guard and checks allow / deny.
 * Run: node --test .cursor/hooks/guard-read.checks.mjs
 * The name is `.checks.mjs`, not `.test.mjs`: ESLint rewrites `node:test` to vitest in test files.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { decideRead } from './guard-read.mjs'

const home = '/home/agent'

/**
 * @param {string} filePath
 */
function denied(filePath) {
  const result = decideRead(filePath, { home })
  assert.equal(result.permission, 'deny', filePath)
  assert.match(result.user_message, /do not read/)
  assert.equal(result.agent_message, undefined)
}

/**
 * @param {string} filePath
 */
function allowed(filePath) {
  const result = decideRead(filePath, { home })
  assert.equal(result.permission, 'allow', filePath)
  assert.equal(result.user_message, undefined)
}

/**
 * @param {unknown} input
 * @param {string} [bin]
 */
function run(input, bin = 'node') {
  const args = bin === 'node'
    ? ['.cursor/hooks/guard-read.mjs']
    : ['.cursor/hooks/guard-read.sh']
  const result = spawnSync(bin, args, {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('denies secret env files, keys, and the home ssh directory', () => {
  for (const filePath of [
    '.env',
    '/workspace/.env',
    '/workspace/.env.local',
    '/workspace/.env.migrate',
    '/workspace/app/.env.production',
    '/workspace/certs/server.pem',
    '/workspace/certs/server.pem/',
    '/workspace/certs/server.key',
    '/workspace/.env/',
    '/home/agent/.ssh/id_rsa',
    '/home/agent/.ssh/id_ed25519.pub',
    '/home/agent/.ssh/config',
    '/home/agent/.ssh/../.ssh/known_hosts',
  ]) {
    denied(filePath)
  }
})

test('allows example env files, ordinary files, and an ssh directory elsewhere', () => {
  for (const filePath of [
    '/workspace/.env.example',
    '/workspace/.env.local.example',
    '/workspace/README.md',
    '/workspace/notes.example',
    '/workspace/src/app.ts',
    '/home/agent/projects/app/.ssh/config',
    '/home/agent/.ssh-backup/id_rsa',
    '/workspace/certs/server.pem.example',
  ]) {
    allowed(filePath)
  }
})

test('the read hook denies bad JSON and a missing path, and agrees with the shell entry', () => {
  const bad = run('not-json')
  assert.equal(bad.permission, 'deny')

  const missing = run({ hook_event_name: 'beforeReadFile' })
  assert.equal(missing.permission, 'deny')

  const secret = run({ file_path: '/workspace/.env', hook_event_name: 'beforeReadFile' })
  assert.equal(secret.permission, 'deny')

  const sample = run({ file_path: '/workspace/.env.example', hook_event_name: 'beforeReadFile' })
  assert.equal(sample.permission, 'allow')

  const viaShell = run({ file_path: '/workspace/certs/server.key' }, 'sh')
  assert.equal(viaShell.permission, 'deny')

  const readme = run({ file_path: '/workspace/README.md' }, 'sh')
  assert.equal(readme.permission, 'allow')
})
