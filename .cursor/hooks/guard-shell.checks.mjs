/**
 * Feeds sample commands to the shell guard and checks allow / deny.
 * Run: node --test .cursor/hooks/guard-shell.checks.mjs
 * The name is `.checks.mjs`, not `.test.mjs`: ESLint rewrites `node:test` to vitest in test files.
 *
 * Policy cases call `decide` with `isSocket: () => false`. That is the local
 * environment. Spawning the CLI would stat the real `/run/cursor/api.sock`,
 * which exists on a managed VM and would allow git commit and git push.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'
import test from 'node:test'
import { decide, isCloudAgent } from './guard-shell.mjs'

const FIXED_SOCKET = '/run/cursor/api.sock'

/** Local: no worker id, and the metadata socket is not present. */
const localDeps = { isSocket: () => false }

/**
 * @param {NodeJS.ProcessEnv} extra
 */
function localEnv(extra = {}) {
  return {
    CURSOR_AGENT_WORKER_ID: '',
    ...extra,
  }
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ isSocket?: (filePath: string) => boolean, conversationId?: string }} [deps]
 */
function verdict(command, env = localEnv(), deps = localDeps) {
  return decide(command, env, 0, deps)
}

/**
 * @param {string} command
 * @param {RegExp} pattern
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ isSocket?: (filePath: string) => boolean, conversationId?: string }} [deps]
 */
function denied(command, pattern, env = localEnv(), deps = localDeps) {
  const result = verdict(command, env, deps)
  assert.equal(result.permission, 'deny', command)
  assert.match(result.user_message, /transferpro shell guard/)
  assert.match(result.agent_message, pattern)
  assert.equal(result.user_message, result.agent_message)
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ isSocket?: (filePath: string) => boolean, conversationId?: string }} [deps]
 */
function allowed(command, env = localEnv(), deps = localDeps) {
  const result = verdict(command, env, deps)
  assert.equal(result.permission, 'allow', `${command} -> ${result.user_message ?? ''}`)
}

/**
 * Spawn only for commands whose verdict does not depend on the metadata socket.
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [bin]
 * @param {Record<string, unknown>} [input]
 */
function run(command, env = {}, bin = 'node', input = {}) {
  const args = bin === 'node'
    ? ['.cursor/hooks/guard-shell.mjs']
    : ['.cursor/hooks/guard-shell.sh']
  const result = spawnSync(bin, args, {
    input: JSON.stringify({
      command,
      cwd: '/workspace',
      hook_event_name: 'beforeShellExecution',
      sandbox: false,
      ...input,
    }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('allows ordinary work', () => {
  for (const command of [
    'pnpm test',
    'pnpm lint',
    'git status',
    'git diff',
    'git add AGENTS.md',
    'git branch chore/agent-rules',
    'echo "git commit"',
    'cat README.md',
    'cat .env.example',
    'grep SECRET src',
    'rm -rf /tmp/transferpro-not-modules',
    'head -n 5 README.md',
  ]) {
    allowed(command)
  }
})

test('denies git history and branch commands for a local agent', () => {
  for (const command of [
    'git commit -m "chore: test"',
    'git push -u origin chore/agent-rules',
    'git reset --hard',
    'git checkout develop',
    'git checkout -- AGENTS.md',
    'git checkout -b chore/other',
    'git checkout -b',
    'git checkout -B chore/other',
    'git stash',
    'git stash push',
    'git switch develop',
    'git switch -',
    'git switch -c chore/other',
    'git switch -c',
    'git switch -C chore/other',
    'git restore AGENTS.md',
    'git -C /tmp/repo commit -m "chore: test"',
    '/usr/bin/git push',
    'sudo git commit -m "chore: test"',
    'sudo -u root git reset --hard',
    'command git stash',
  ]) {
    denied(command, /git/)
  }
})

test('a local env denies a shell opt-out and a worker id prefix', () => {
  for (const command of [
    'env TP_ALLOW_GIT=1 git push',
    'TP_ALLOW_GIT=1 git commit -m x',
    'export TP_ALLOW_GIT=1 && git commit -m x',
    'CURSOR_AGENT_WORKER_ID=x git push',
    'export CURSOR_AGENT_WORKER_ID=x; git push',
  ]) {
    denied(command, /git commit or git push/)
  }
  denied('git push', /git commit or git push/, { TP_ALLOW_GIT: '1', CURSOR_AGENT_WORKER_ID: '' })
  denied('git commit -m x', /git commit or git push/, { CURSOR_AGENT_WORKER_ID: 'x' })
})

test('a worker id allows git writes only with a bc- conversation id', () => {
  const worker = { CURSOR_AGENT_WORKER_ID: 'worker-1' }
  const cloud = { ...localDeps, conversationId: 'bc-123' }
  assert.equal(isCloudAgent(worker, cloud), true)
  assert.equal(isCloudAgent(worker, localDeps), false)
  assert.equal(isCloudAgent(worker, { ...localDeps, conversationId: 'local-1' }), false)
  assert.equal(isCloudAgent(localEnv(), { ...localDeps, conversationId: 'bc-123' }), false)

  for (const command of [
    'git commit -m "chore: test"',
    'git push',
    'git checkout -b chore/other',
    'git checkout -b chore/other develop',
    'git switch -c chore/other',
    'git switch -c chore/other develop',
  ]) {
    allowed(command, worker, cloud)
    denied(command, /git/, worker, localDeps)
  }

  denied('git reset --hard HEAD', /git reset/, worker, cloud)
  denied('git checkout develop', /git checkout/, worker, cloud)
  denied('git checkout -- AGENTS.md', /git checkout/, worker, cloud)
  denied('git checkout -b', /git checkout/, worker, cloud)
  denied('git checkout -B chore/other', /git checkout/, worker, cloud)
  denied('git checkout -b chore/other -B other', /git checkout/, worker, cloud)
  denied('git stash', /git stash/, worker, cloud)
  denied('git switch develop', /git switch/, worker, cloud)
  denied('git switch -', /git switch/, worker, cloud)
  denied('git switch -c', /git switch/, worker, cloud)
  denied('git switch -C chore/other', /git switch/, worker, cloud)
  denied('git switch -c chore/other -C other', /git switch/, worker, cloud)
  denied('git restore --source=HEAD AGENTS.md', /git restore/, worker, cloud)
  denied('cat .env', /do not read/, worker, cloud)
  denied('rm -rf node_modules', /node_modules/, worker, cloud)
})

test('the metadata socket is the fixed path, and a true stat allows git writes', () => {
  /** @type {string[]} */
  const seen = []
  const deps = {
    isSocket: (filePath) => {
      seen.push(filePath)
      return filePath === FIXED_SOCKET
    },
  }
  allowed('git commit -m "chore: test"', { CURSOR_AGENT_SOCKET: '/tmp/not-the-socket', CURSOR_AGENT_WORKER_ID: '' }, deps)
  allowed('git push', localEnv(), deps)
  assert.deepEqual(seen, [FIXED_SOCKET, FIXED_SOCKET])

  const missing = {
    isSocket: (filePath) => {
      assert.equal(filePath, FIXED_SOCKET)
      return false
    },
  }
  denied('git push', /git commit or git push/, { CURSOR_AGENT_SOCKET: FIXED_SOCKET }, missing)
})

test('denies deletion of node_modules and .modules.yaml', () => {
  for (const command of [
    'rm -rf node_modules',
    'rm -rf ./node_modules',
    'rm -rf /workspace/node_modules/',
    'rm node_modules/.modules.yaml',
    'unlink .modules.yaml',
    'rmdir node_modules',
    'find node_modules -delete',
    'find . -path ./node_modules -exec rm -rf {} +',
  ]) {
    denied(command, /node_modules or \.modules\.yaml/)
  }
  allowed('rm -rf node_modules.bak')
  allowed('find . -name "*.log" -delete')
})

test('denies reading secret env files and env dumps', () => {
  for (const command of [
    'cat .env',
    'cat ./.env',
    'cat /workspace/.env.migrate',
    'cat ".env.local"',
    'less .env',
    'head -n 20 .env',
    'tail .env.production',
    'grep SECRET .env',
    'grep -n -- .env.migrate',
    'printenv',
    'printenv DATABASE_URL',
    'env',
    'env -0',
    'env FOO=1',
  ]) {
    denied(command, /do not/)
  }
  allowed('env pnpm test')
  allowed('env FOO=1 pnpm lint')
  allowed('cat .env.example')
})

test('inspects chained commands and inline shells', () => {
  denied('pnpm test && cat .env', /do not read/)
  denied('pnpm test; git reset --hard', /git reset/)
  denied('bash -lc "git commit -m \'chore: test\'"', /git commit or git push/)
  denied('sh -c "rm -rf node_modules"', /node_modules/)
  allowed('bash -lc "pnpm test"')
  allowed('echo foo && git status')
})

test('the shell entrypoint agrees with the node checker', () => {
  const viaShell = run('git reset --hard', {}, 'sh')
  assert.equal(viaShell.permission, 'deny')
  const ok = run('git status', {}, 'sh')
  assert.equal(ok.permission, 'allow')
})

test('bad hook JSON is denied and an empty command is allowed', () => {
  const bad = spawnSync('node', ['.cursor/hooks/guard-shell.mjs'], {
    input: 'not-json',
    encoding: 'utf8',
  })
  assert.equal(bad.status, 0)
  assert.equal(JSON.parse(bad.stdout).permission, 'deny')

  const empty = spawnSync('node', ['.cursor/hooks/guard-shell.mjs'], {
    input: JSON.stringify({ hook_event_name: 'beforeShellExecution' }),
    encoding: 'utf8',
  })
  assert.equal(empty.status, 0)
  assert.equal(JSON.parse(empty.stdout).permission, 'allow')
})

test('the CLI passes conversation_id from stdin into the worker-id gate', (t) => {
  // On a managed VM the fixed socket already allows git push, so this
  // wiring is asserted through decide() above. CI has no such socket.
  let present = false
  try {
    present = fs.statSync(FIXED_SOCKET).isSocket()
  }
  catch {
    present = false
  }
  if (present) {
    t.skip('metadata socket is present; decide() covers the worker-id gate')
    return
  }

  const deniedPush = run('git push', { CURSOR_AGENT_WORKER_ID: 'x' }, 'node', { conversation_id: 'local' })
  assert.equal(deniedPush.permission, 'deny')
  const allowedPush = run('git push', { CURSOR_AGENT_WORKER_ID: 'x' }, 'node', { conversation_id: 'bc-ci' })
  assert.equal(allowedPush.permission, 'allow')
  const prefix = run('export CURSOR_AGENT_WORKER_ID=x; git push', {}, 'node', { conversation_id: 'bc-ci' })
  assert.equal(prefix.permission, 'deny')
})
