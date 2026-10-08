/**
 * Feeds sample commands to the shell guard and checks allow / deny.
 * Run: node --test .cursor/hooks/guard-shell.checks.mjs
 * The name is `.checks.mjs`, not `.test.mjs`: ESLint rewrites `node:test` to vitest in test files.
 *
 * Policy cases call `decide` with `isSocket: () => false`. That is the local
 * environment. Spawning the CLI would stat the real `/run/cursor/api.sock`,
 * which exists on a managed VM and would allow every git commit and git push.
 * Local allow/deny for commit and push is injected with `currentBranch` and
 * `remotes` so the cases do not depend on this checkout.
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
  const here = { ...localDeps, currentBranch: 'chore/agent-rules', remotes: ['origin'], upstreamBranch: '' }
  for (const command of [
    'pnpm test',
    'pnpm lint',
    'git status',
    'git diff',
    'git add AGENTS.md',
    'git branch chore/agent-rules',
    'git branch -d chore/merged',
    'echo "git commit"',
    'cat README.md',
    'cat .env.example',
    'grep SECRET src',
    'rm -rf /tmp/transferpro-not-modules',
    'head -n 5 README.md',
  ]) {
    allowed(command, localEnv(), here)
  }
})

test('a local agent may commit and push only on a work branch', () => {
  const work = { ...localDeps, remotes: ['origin'] }
  for (const branch of ['feature/90-workflow', 'fix/90-workflow', 'chore/90-workflow']) {
    allowed('git commit -m "chore: test"', localEnv(), { ...work, currentBranch: branch })
    allowed('git add AGENTS.md', localEnv(), { ...work, currentBranch: branch })
    allowed(`git push -u origin ${branch}`, localEnv(), { ...work, currentBranch: branch })
    allowed(`git push origin ${branch}`, localEnv(), { ...work, currentBranch: branch })
    allowed(`git push origin HEAD:refs/heads/${branch}`, localEnv(), { ...work, currentBranch: branch })
  }
  allowed('git push', localEnv(), { ...work, currentBranch: 'chore/90-workflow', upstreamBranch: 'chore/90-workflow' })
  allowed('git push origin', localEnv(), { ...work, currentBranch: 'chore/90-workflow', upstreamBranch: '' })
  allowed('git push -u origin HEAD', localEnv(), { ...work, currentBranch: 'fix/90-workflow', upstreamBranch: '' })
  denied('git add AGENTS.md', /feature\/\*/, localEnv(), { ...localDeps, currentBranch: 'develop' })
  denied('git push', /feature\/\*/, localEnv(), { ...work, currentBranch: 'chore/90-workflow', upstreamBranch: 'develop' })
  denied('git push origin', /feature\/\*/, localEnv(), { ...work, currentBranch: 'chore/90-workflow', upstreamBranch: 'main' })
})

test('a local agent may not push elsewhere, force-push, hard-reset, or discard', () => {
  const work = { ...localDeps, remotes: ['origin'], currentBranch: 'chore/90-workflow' }
  for (const command of [
    'git push origin develop',
    'git push origin main',
    'git push -u origin develop',
    'git push origin feature/ok:develop',
    'git push origin other/topic',
    'git push --force origin chore/90-workflow',
    'git push --force-with-lease origin chore/90-workflow',
    'git push -f -u origin chore/90-workflow',
    'git push origin +chore/90-workflow',
    'git push origin --delete chore/90-workflow',
    'git push origin :chore/90-workflow',
    'git push --prune origin',
    'git push --mirror origin',
    'git push --all origin',
    'git push --tags',
    'git commit -m "chore: test"',
    'git reset --hard',
    'git reset --hard HEAD',
    'git checkout -- AGENTS.md',
    'git checkout develop',
    'git restore AGENTS.md',
    'git restore --source=HEAD AGENTS.md',
    'git stash',
    'git stash drop',
    'git branch -D chore/90-workflow',
    'git branch -D',
  ]) {
    denied(command, /git/, localEnv(), command.startsWith('git commit')
      ? { ...localDeps, currentBranch: 'develop' }
      : work)
  }
  denied('git commit -m "chore: test"', /feature\/\*/, localEnv(), { ...localDeps, currentBranch: 'main' })
  denied('git commit -m "chore: test"', /feature\/\*/, localEnv(), { ...localDeps, currentBranch: 'topic' })
  // Empty upstream so a work-branch checkout does not hide this denial.
  denied('git push', /feature\/\*/, localEnv(), { ...work, currentBranch: 'develop', upstreamBranch: '' })
  denied('git push origin develop', /feature\/\*/, localEnv(), work)
})

test('denies git history and branch commands for a local agent', () => {
  const other = { ...localDeps, currentBranch: 'develop', remotes: ['origin'] }
  for (const command of [
    'git commit -m "chore: test"',
    'git push -u origin develop',
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
    '/usr/bin/git push origin develop',
    'sudo git commit -m "chore: test"',
    'sudo -u root git reset --hard',
    'command git stash',
  ]) {
    denied(command, /git/, localEnv(), other)
  }
})

test('a local env denies a shell opt-out and a worker id prefix', () => {
  const other = { ...localDeps, currentBranch: 'develop', remotes: ['origin'] }
  for (const command of [
    'env TP_ALLOW_GIT=1 git push origin develop',
    'TP_ALLOW_GIT=1 git commit -m x',
    'export TP_ALLOW_GIT=1 && git commit -m x',
    'CURSOR_AGENT_WORKER_ID=x git push origin develop',
    'export CURSOR_AGENT_WORKER_ID=x; git push origin develop',
  ]) {
    denied(command, /feature\/\*/, localEnv(), other)
  }
  denied('git push origin develop', /feature\/\*/, { TP_ALLOW_GIT: '1', CURSOR_AGENT_WORKER_ID: '' }, other)
  denied('git commit -m x', /feature\/\*/, { CURSOR_AGENT_WORKER_ID: 'x' }, other)
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
    denied(command, /git/, worker, { ...localDeps, currentBranch: 'develop', remotes: ['origin'], upstreamBranch: '' })
  }

  allowed('git push origin develop', worker, cloud)
  allowed('git push origin main', worker, cloud)
  allowed('git branch -D chore/other', worker, cloud)
  denied('git push origin develop', /feature\/\*/, worker, { ...localDeps, remotes: ['origin'], currentBranch: 'chore/other' })
  denied('git branch -D chore/other', /git branch -D/, worker, localDeps)

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
  denied('git push origin develop', /feature\/\*/, { CURSOR_AGENT_SOCKET: FIXED_SOCKET }, { ...missing, remotes: ['origin'], currentBranch: 'develop' })
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
  denied('bash -lc "git commit -m \'chore: test\'"', /feature\/\*/, localEnv(), { ...localDeps, currentBranch: 'develop' })
  allowed('bash -lc "git push -u origin chore/inline"', localEnv(), { ...localDeps, remotes: ['origin'], currentBranch: 'develop' })
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

  const deniedPush = run('git push origin develop', { CURSOR_AGENT_WORKER_ID: 'x' }, 'node', { conversation_id: 'local' })
  assert.equal(deniedPush.permission, 'deny')
  const allowedPush = run('git push origin develop', { CURSOR_AGENT_WORKER_ID: 'x' }, 'node', { conversation_id: 'bc-ci' })
  assert.equal(allowedPush.permission, 'allow')
  const localWork = run('git push -u origin chore/cli-ok', {}, 'node', { conversation_id: 'local' })
  assert.equal(localWork.permission, 'allow')
  const prefix = run('export CURSOR_AGENT_WORKER_ID=x; git push origin develop', {}, 'node', { conversation_id: 'bc-ci' })
  assert.equal(prefix.permission, 'deny')
})

test('a local agent cannot skip husky with --no-verify', () => {
  const work = { ...localDeps, remotes: ['origin'], currentBranch: 'chore/90-workflow', upstreamBranch: 'chore/90-workflow' }
  const worker = { CURSOR_AGENT_WORKER_ID: 'worker-1' }
  const cloud = { ...localDeps, conversationId: 'bc-123', remotes: ['origin'], currentBranch: 'develop' }

  denied('git commit --no-verify -m "chore: test"', /do not skip git hooks/, localEnv(), work)
  denied('git commit -n -m "chore: test"', /do not skip git hooks/, localEnv(), work)
  denied('git push --no-verify origin chore/90-workflow', /do not skip git hooks/, localEnv(), work)
  allowed('git commit -m "chore: test"', localEnv(), work)
  allowed('git push origin chore/90-workflow', localEnv(), work)
  // push -n is dry-run, not --no-verify.
  allowed('git push -n origin chore/90-workflow', localEnv(), work)
  allowed('git commit --no-verify -m "chore: test"', worker, cloud)
  allowed('git commit -n -m "chore: test"', worker, cloud)
  allowed('git push --no-verify origin develop', worker, cloud)
})

test('a local agent cannot retarget add, commit, or push with git config', () => {
  const work = { ...localDeps, remotes: ['origin'], currentBranch: 'chore/90-workflow', upstreamBranch: 'chore/90-workflow' }
  const worker = { CURSOR_AGENT_WORKER_ID: 'worker-1' }
  const cloud = { ...localDeps, conversationId: 'bc-123', remotes: ['origin'], currentBranch: 'develop' }

  for (const command of [
    'git -c remote.origin.push=HEAD:develop push origin',
    'git -c user.name=hidden commit -m "chore: test"',
    'git -c core.hooksPath=/tmp add AGENTS.md',
    'git --config-env=remote.origin.push=PUSH_TARGET push origin',
    'git --config-env remote.origin.push=PUSH_TARGET commit -m "chore: test"',
    'GIT_CONFIG_PARAMETERS=\'remote.origin.push=HEAD:develop\' git push origin chore/90-workflow',
    'GIT_CONFIG_COUNT=1 git commit -m "chore: test"',
    'GIT_CONFIG_KEY_0=remote.origin.push git push origin',
    'env GIT_CONFIG_COUNT=2 git add AGENTS.md',
    'export GIT_CONFIG_COUNT=1; git push origin chore/90-workflow',
    'export GIT_CONFIG_KEY_0=remote.origin.push; git commit -m "chore: test"',
  ]) {
    denied(command, /do not pass git -c or --config-env|do not set GIT_CONFIG_/, localEnv(), work)
  }

  allowed('git push origin', localEnv(), work)
  allowed('git -c color.ui=never status', localEnv(), work)
  allowed('git --config-env=color.ui=NO_COLOR status', localEnv(), work)
  allowed('GIT_CONFIG_COUNT=1 git status', localEnv(), work)
  allowed('git config --get user.name', localEnv(), work)
  allowed('git config --list', localEnv(), work)
  allowed('git config -l', localEnv(), work)
  allowed('git config user.name', localEnv(), work)
  allowed('git config --global --get user.email', localEnv(), work)

  for (const command of [
    'git config user.name hidden',
    'git config --global user.email hidden@example.com',
    'git config --unset user.name',
    'git config --unset-all user.name',
    'git config --add remote.origin.push HEAD:develop',
    'git config --replace-all remote.origin.push HEAD:develop',
    'git config --edit',
    'git config -e',
    'git config --remove-section remote.origin',
    'git config --rename-section remote.origin remote.elsewhere',
  ]) {
    denied(command, /write git config/, localEnv(), work)
  }

  allowed('git -c remote.origin.push=HEAD:develop push origin', worker, cloud)
  allowed('git --config-env=remote.origin.push=PUSH_TARGET push origin develop', worker, cloud)
  allowed('GIT_CONFIG_COUNT=1 git push origin develop', worker, cloud)
  allowed('export GIT_CONFIG_KEY_0=remote.origin.push; git commit -m "chore: test"', worker, cloud)
  allowed('git config user.name hidden', worker, cloud)
})

test('a local agent cannot set CI=1 for pnpm or run pnpm install', () => {
  const worker = { CURSOR_AGENT_WORKER_ID: 'worker-1' }
  const cloud = { ...localDeps, conversationId: 'bc-123' }

  for (const command of [
    'CI=1 pnpm test',
    'env CI=1 pnpm lint',
    'export CI=1; pnpm test',
    'export CI=1 && pnpm exec node -v',
    'CI=1 bash -lc "pnpm test"',
    'export CI=1; bash -lc "pnpm test"',
  ]) {
    denied(command, /do not run pnpm with CI=1/, localEnv(), localDeps)
  }

  allowed('pnpm test')
  allowed('env FOO=1 pnpm lint')
  allowed('CI=0 pnpm test')
  allowed('export CI=1; unset CI; pnpm test')
  allowed('export CI=1; git status', localEnv(), { ...localDeps, currentBranch: 'chore/90-workflow' })

  for (const command of [
    'pnpm install',
    'pnpm i',
    'pnpm install --frozen-lockfile',
    'pnpm --dir apps/web install',
    'pnpm -C . i',
    'pnpm --filter @app/web install',
  ]) {
    denied(command, /do not run pnpm install/)
  }

  allowed('pnpm run test')
  allowed('pnpm exec node -v')
  allowed('CI=1 pnpm test', worker, cloud)
  allowed('export CI=1; pnpm test', worker, cloud)
  allowed('pnpm install', worker, cloud)
  allowed('pnpm i --frozen-lockfile', worker, cloud)
})

test('push -o takes a value the way --push-option does', () => {
  const upstreamDevelop = {
    ...localDeps,
    remotes: ['origin'],
    currentBranch: 'chore/90-workflow',
    upstreamBranch: 'develop',
  }
  const upstreamWork = { ...upstreamDevelop, upstreamBranch: 'chore/90-workflow' }

  allowed('git push -o ci.skip origin chore/90-workflow', localEnv(), upstreamDevelop)
  allowed('git push origin -o ci.skip chore/90-workflow', localEnv(), upstreamDevelop)
  allowed('git push --push-option ci.skip origin chore/90-workflow', localEnv(), upstreamDevelop)
  allowed('git push -o ci.skip origin', localEnv(), upstreamWork)
  denied('git push -o feature/decoy', /feature\/\*/, localEnv(), upstreamDevelop)
  denied('git push -o ci.skip origin develop', /feature\/\*/, localEnv(), upstreamDevelop)
})
