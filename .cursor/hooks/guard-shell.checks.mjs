/**
 * Feeds sample commands to the shell guard and checks allow / deny.
 * Run: node --test .cursor/hooks/guard-shell.checks.mjs
 * The name is `.checks.mjs`, not `.test.mjs`: ESLint rewrites `node:test` to vitest in test files.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

/**
 * Local-agent environment: no worker id, no metadata socket, no opt-out.
 * Spreading process.env keeps PATH. Overrides win over the cloud VM this
 * test may itself be running in.
 * @param {NodeJS.ProcessEnv} extra
 */
function hookEnv(extra = {}) {
  return {
    ...process.env,
    CURSOR_AGENT_SOCKET: path.join(os.tmpdir(), 'transferpro-no-such-hook.sock'),
    CURSOR_AGENT_WORKER_ID: '',
    TP_ALLOW_GIT: '',
    ...extra,
  }
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [bin]
 */
function run(command, env = {}, bin = 'node') {
  const args = bin === 'node'
    ? ['.cursor/hooks/guard-shell.mjs']
    : ['.cursor/hooks/guard-shell.sh']
  const result = spawnSync(bin, args, {
    input: JSON.stringify({
      command,
      cwd: '/workspace',
      hook_event_name: 'beforeShellExecution',
      sandbox: false,
    }),
    encoding: 'utf8',
    env: hookEnv(env),
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

/**
 * @param {string} command
 * @param {RegExp} pattern
 * @param {NodeJS.ProcessEnv} [env]
 */
function denied(command, pattern, env) {
  const verdict = run(command, env)
  assert.equal(verdict.permission, 'deny', command)
  assert.match(verdict.user_message, /transferpro shell guard/)
  assert.match(verdict.agent_message, pattern)
  assert.equal(verdict.user_message, verdict.agent_message)
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 */
function allowed(command, env) {
  const verdict = run(command, env)
  assert.equal(verdict.permission, 'allow', `${command} -> ${verdict.user_message ?? ''}`)
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
    'git checkout -b chore/other',
    'git stash',
    'git stash push',
    'git switch develop',
    'git switch -c chore/other',
    'git restore AGENTS.md',
    'git -C /tmp/repo commit -m "chore: test"',
    '/usr/bin/git push',
    'sudo git commit -m "chore: test"',
    'sudo -u root git reset --hard',
    'command git stash',
    'TP_ALLOW_GIT=1 git commit -m "chore: test"',
  ]) {
    denied(command, /git/)
  }
})

test('cloud agent and TP_ALLOW_GIT=1 may commit and push, and nothing else on that list', () => {
  const cloud = { CURSOR_AGENT_WORKER_ID: 'worker-1' }
  const opted = { TP_ALLOW_GIT: '1' }
  for (const env of [cloud, opted]) {
    allowed('git commit -m "chore: test"', env)
    allowed('git push', env)
    denied('git reset --hard HEAD', /git reset/, env)
    denied('git checkout -- AGENTS.md', /git checkout/, env)
    denied('git stash', /git stash/, env)
    denied('git switch -', /git switch/, env)
    denied('git restore --source=HEAD AGENTS.md', /git restore/, env)
    denied('cat .env', /do not read/, env)
    denied('rm -rf node_modules', /node_modules/, env)
  }
})

test('a metadata socket allows commit; a regular file at that path does not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-guard-'))
  const sockPath = path.join(dir, 'api.sock')
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(sockPath, resolve)
  })
  const plain = path.join(dir, 'not-a-socket')
  fs.writeFileSync(plain, '')
  try {
    allowed('git commit -m "chore: test"', { CURSOR_AGENT_SOCKET: sockPath })
    denied('git push', /git commit or git push/, { CURSOR_AGENT_SOCKET: plain })
  }
  finally {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
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
    env: hookEnv(),
  })
  assert.equal(bad.status, 0)
  assert.equal(JSON.parse(bad.stdout).permission, 'deny')

  const empty = spawnSync('node', ['.cursor/hooks/guard-shell.mjs'], {
    input: JSON.stringify({ hook_event_name: 'beforeShellExecution' }),
    encoding: 'utf8',
    env: hookEnv(),
  })
  assert.equal(empty.status, 0)
  assert.equal(JSON.parse(empty.stdout).permission, 'allow')
})
