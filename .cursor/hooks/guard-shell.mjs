/**
 * beforeShellExecution policy for transferpro.
 *
 * Cursor sends one JSON object on stdin and expects one JSON object on
 * stdout: { permission: "allow" | "deny" | "ask", user_message, agent_message }.
 * Project hooks run in cloud agents (cursor.com/docs/hooks). A local IDE
 * agent also has CURSOR_AGENT set, so that variable is not a cloud signal.
 * A managed VM counts when the fixed path /run/cursor/api.sock is a unix
 * socket. The path is not taken from the environment, and the socket is not
 * read. A worker id counts only together with a conversation id from hook
 * stdin that starts with `bc-`. A shell export cannot set that field.
 * A cloud agent may commit, push, and `git checkout -b` / `git switch -c`.
 * A local agent may `git add`, `git commit`, and `git push` only for a
 * `feature/*`, `fix/*`, or `chore/*` branch, including `git push -u origin <branch>`.
 * Force, a `+refspec`, a push to any other branch, and deleting a remote
 * branch stay denied locally. A prefix on the command does not count:
 * the agent could add it itself.
 * Local add, commit, and push also refuse `git -c`, `--config-env`, and a
 * GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT / GIT_CONFIG_KEY_* prefix, because
 * those retarget the push without a refspec the parser can see. Commit
 * refuses `--no-verify` and `-n`, and push refuses `--no-verify`, so husky
 * still runs. `git config` writes are refused locally; `--get` and `--list`
 * stay allowed. `CI=1 pnpm` and `pnpm install` / `pnpm i` are refused
 * locally. A cloud agent is not subject to these local refusals.
 */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const ALWAYS_BLOCKED_GIT = new Set(['reset', 'checkout', 'stash', 'switch', 'restore'])
const LOCAL_BRANCH_WRITES = new Set(['add', 'commit', 'push'])
/** Ticket branches an agent may commit on and push to. `feature/` alone is not one. */
const WORK_BRANCH = /^(?:feature|fix|chore)\/.+/
const PUSH_OPTIONS_WITH_VALUE = new Set([
  '--receive-pack',
  '--exec',
  '--repo',
  '--push-option',
  '-o',
  '--recurse-submodules',
])
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--exec-path',
])
const ENV_OPTIONS_WITH_VALUE = new Set([
  '-u',
  '-C',
  '--unset',
  '--chdir',
  '--block-signal',
  '--default-signal',
  '--ignore-signal',
])
/** pnpm flags whose next word is a value, so it is not the subcommand. */
const PNPM_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '--dir',
  '-F',
  '--filter',
  '--filter-prod',
  '--loglevel',
  '--reporter',
  '--global-dir',
  '--store-dir',
  '--virtual-store-dir',
  '--lockfile-dir',
  '--modules-dir',
  '--registry',
  '--test-pattern',
  '--changed-files-ignore-pattern',
  '--access',
  '--audit-level',
  '--bump',
  '--child-concurrency',
  '--cpu',
  '--depth',
  '--format',
  '--hoist-pattern',
  '--ignore',
  '--init-type',
  '--libc',
  '--location',
  '--message',
  '--network-concurrency',
  '--os',
  '--out',
  '--pack-destination',
  '--preid',
  '--public-hoist-pattern',
  '--sbom-authors',
  '--sbom-format',
  '--sbom-spec-version',
  '--sbom-supplier',
  '--sbom-type',
  '--scope',
  '--search-limit',
  '--summary',
  '--tag',
  '--tag-version-prefix',
  '--trust-policy-exclude',
  '--trust-policy-ignore-after',
  '--workspace-concurrency',
])
const CONFIG_WRITE_FLAGS = new Set([
  '--add',
  '--replace-all',
  '--unset',
  '--unset-all',
  '--rename-section',
  '--remove-section',
  '--edit',
  '-e',
])
const CONFIG_READ_FLAGS = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '--list',
  '-l',
  '--get-color',
  '--get-colorbool',
])
const CONFIG_OPTIONS_WITH_VALUE = new Set([
  '-f',
  '--file',
  '--blob',
  '--default',
  '--comment',
  '-t',
  '--type',
])
const WRAPPERS = new Set(['command', 'exec', 'time', 'nice', 'nohup'])
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'ash'])
const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep'])
const REMOVERS = new Set(['rm', 'unlink', 'rmdir'])

const MAX_DEPTH = 6

/** Not CURSOR_AGENT_SOCKET: a shell export must not point the check at another file. */
const FIXED_METADATA_SOCKET = '/run/cursor/api.sock'

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @param {number} [depth]
 * @param {{ isSocket?: (path: string) => boolean, conversationId?: string, currentBranch?: string, remotes?: string[] }} [deps]
 */
export function decide(command, env = process.env, depth = 0, deps = {}) {
  if (depth > MAX_DEPTH) {
    return deny(
      'nested shell commands are too deep to inspect.',
      command,
    )
  }

  // Exports stick for later statements in this shell. Prefix assignments do not.
  // A nested `sh -c` inherits a copy so its exports do not leak back out.
  const shell = deps.shell ?? { ci: false, gitConfigNames: new Set() }

  for (const statement of splitStatements(command)) {
    const verdict = inspectStatement(statement, env, depth, deps, shell)
    if (verdict.permission === 'deny')
      return verdict
    recordExports(statement, shell)
  }
  return allow()
}

/**
 * Fixed-path socket, or worker id plus a `bc-` conversation id from hook stdin.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ isSocket?: (path: string) => boolean, conversationId?: string }} [deps]
 */
export function isCloudAgent(env, deps = {}) {
  const check = deps.isSocket ?? isSocket
  if (check(FIXED_METADATA_SOCKET))
    return true
  const conversationId = deps.conversationId ?? ''
  return Boolean(env.CURSOR_AGENT_WORKER_ID) && conversationId.startsWith('bc-')
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ isSocket?: (path: string) => boolean, conversationId?: string }} [deps]
 */
export function gitWritesAllowed(env, deps = {}) {
  return isCloudAgent(env, deps)
}

/**
 * @param {string} command
 */
export function splitStatements(command) {
  /** @type {string[]} */
  const parts = []
  let buf = ''
  /** @type {string | null} */
  let quote = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      buf += ch
      if (ch === '\\' && quote !== '\'' && i + 1 < command.length) {
        buf += command[++i]
        continue
      }
      if (ch === quote)
        quote = null
      continue
    }
    if (ch === '\\' && i + 1 < command.length) {
      buf += ch
      buf += command[++i]
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '\n' || ch === ';') {
      parts.push(buf)
      buf = ''
      continue
    }
    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      parts.push(buf)
      buf = ''
      i++
      continue
    }
    if (ch === '&' || ch === '|') {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  parts.push(buf)
  return parts.map(part => part.trim()).filter(Boolean)
}

/**
 * Split one simple command into words. Quotes are removed; the quoted text stays one word.
 * @param {string} statement
 */
function tokenize(statement) {
  /** @type {string[]} */
  const tokens = []
  let buf = ''
  /** @type {string | null} */
  let quote = null

  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i]
    if (quote) {
      if (ch === '\\' && quote !== '\'' && i + 1 < statement.length) {
        buf += statement[++i]
        continue
      }
      if (ch === quote) {
        quote = null
        continue
      }
      buf += ch
      continue
    }
    if (ch === '\\' && i + 1 < statement.length) {
      buf += statement[++i]
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (buf) {
        tokens.push(buf)
        buf = ''
      }
      continue
    }
    buf += ch
  }
  if (buf)
    tokens.push(buf)
  return tokens
}

/**
 * @param {string} statement
 * @param {NodeJS.ProcessEnv} env
 * @param {number} depth
 * @param {{ isSocket?: (path: string) => boolean, conversationId?: string, currentBranch?: string, remotes?: string[], shell?: { ci: boolean, gitConfigNames: Set<string> } }} deps
 * @param {{ ci: boolean, gitConfigNames: Set<string> }} shell
 */
function inspectStatement(statement, env, depth, deps, shell) {
  const unwrapped = unwrap(tokenize(statement))
  const effective = shellAfterAssignments(shell, unwrapped.assignments)
  if (unwrapped.script)
    return decide(unwrapped.script, env, depth + 1, { ...deps, shell: effective })
  if (unwrapped.envDump)
    return deny('do not dump the environment with env.', statement)

  const argv = unwrapped.argv
  if (argv.length === 0)
    return allow()

  const name = baseName(argv[0])
  if (name === 'printenv')
    return deny('do not dump the environment with printenv.', statement)

  const inline = shellInlineScript(argv)
  if (inline !== null)
    return decide(inline, env, depth + 1, { ...deps, shell: effective })

  const cloud = gitWritesAllowed(env, deps)
  const git = gitSubcommand(argv)
  if (git.invoked) {
    // checkout -b and switch -c create a branch. -B and -C reset one that
    // already exists, so they stay denied. Only a cloud agent may create.
    const creating = createsNewBranch(git.name, git.args) && cloud
    if (ALWAYS_BLOCKED_GIT.has(git.name) && !creating) {
      return deny(
        `do not run git ${git.name}. It can discard local changes.`,
        statement,
      )
    }
    // Local only. A cloud agent keeps the previous policy, which allows this.
    if (git.name === 'branch' && !cloud && forceDeletesLocalBranch(git.args)) {
      return deny(
        'do not run git branch -D.',
        statement,
      )
    }
    if (git.name === 'config' && !cloud && gitConfigWrites(git.args)) {
      return deny('do not write git config.', statement)
    }
    if (LOCAL_BRANCH_WRITES.has(git.name) && !cloud) {
      const problem = localWriteProblem(git, deps, effective)
      if (problem)
        return deny(problem, statement)
    }
  }

  if (!cloud && name === 'pnpm') {
    if (effective.ci)
      return deny('do not run pnpm with CI=1.', statement)
    if (isPnpmInstall(pnpmCommandName(argv)))
      return deny('do not run pnpm install.', statement)
  }

  if (removesProtected(argv)) {
    return deny(
      'do not delete node_modules or .modules.yaml.',
      statement,
    )
  }
  if (readsSecretEnv(argv)) {
    return deny(
      'do not read .env files or dump the environment.',
      statement,
    )
  }
  return allow()
}

/**
 * Drop env assignments and wrappers. `env` with no command is a dump.
 * `env VAR=1 cmd` keeps cmd. `sh -c script` is returned as a script.
 * @param {string[]} tokens
 */
function unwrap(tokens) {
  /** @type {string[]} */
  let argv = tokens
  /** @type {string[]} */
  const assignments = []
  for (let hop = 0; hop < 8; hop++) {
    while (argv.length > 0 && isAssignment(argv[0])) {
      assignments.push(argv[0])
      argv = argv.slice(1)
    }
    if (argv.length === 0)
      return { argv, script: null, envDump: false, assignments }

    const name = baseName(argv[0])
    if (name === 'sudo') {
      argv = stripSudo(argv)
      continue
    }
    if (WRAPPERS.has(name)) {
      argv = stripLeadingFlags(argv)
      continue
    }
    if (name === 'env') {
      const parsed = parseEnv(argv)
      if (parsed.kind === 'dump')
        return { argv: [], script: null, envDump: true, assignments }
      if (parsed.kind === 'script') {
        return {
          argv: [],
          script: parsed.script,
          envDump: false,
          assignments: [...assignments, ...parsed.assignments],
        }
      }
      assignments.push(...parsed.assignments)
      argv = parsed.argv
      continue
    }
    return { argv, script: null, envDump: false, assignments }
  }
  return { argv, script: null, envDump: false, assignments }
}

/**
 * @param {string[]} tokens sudo plus the rest
 */
function stripSudo(tokens) {
  let i = 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === '--') {
      i++
      break
    }
    if (token === '-u' || token === '-g' || token === '--user' || token === '--group') {
      i += 2
      continue
    }
    if (token.startsWith('-')) {
      i++
      continue
    }
    break
  }
  return tokens.slice(i)
}

/**
 * Drop the command word and its leading flags. The next word is the real command.
 * @param {string[]} tokens
 */
function stripLeadingFlags(tokens) {
  let i = 1
  while (i < tokens.length && tokens[i].startsWith('-'))
    i++
  return tokens.slice(i)
}

/**
 * @param {string[]} tokens
 * @returns {{ kind: 'dump', assignments: string[] } | { kind: 'script', script: string, assignments: string[] } | { kind: 'command', argv: string[], assignments: string[] }} dump, inline script, or the remaining command
 */
function parseEnv(tokens) {
  /** @type {string[]} */
  const assignments = []
  let i = 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === '--') {
      i++
      break
    }
    if (isAssignment(token)) {
      assignments.push(token)
      i++
      continue
    }
    if (token === '-S' || token === '--split-string') {
      return { kind: 'script', script: tokens[i + 1] ?? '', assignments }
    }
    if (token.startsWith('-')) {
      const opt = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (!token.includes('=') && ENV_OPTIONS_WITH_VALUE.has(opt))
        i += 2
      else
        i++
      continue
    }
    return { kind: 'command', argv: tokens.slice(i), assignments }
  }
  return { kind: 'dump', assignments }
}

/**
 * bash -lc 'git commit' hides the real command in the next argument.
 * @param {string[]} argv
 * @returns {string | null} the inline script, or null when this is not `sh -c`
 */
function shellInlineScript(argv) {
  if (!SHELLS.has(baseName(argv[0])))
    return null
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--')
      return null
    if (token === '-c' || token === '--command')
      return argv[i + 1] ?? ''
    // -lc / -lic: login (and interactive) plus command. The script is the next word.
    // Do not treat a long option that merely contains the letter c as -c.
    if (/^-[lis]*c[lis]*$/.test(token))
      return argv[i + 1] ?? ''
    if (token.startsWith('-'))
      continue
    return null
  }
  return null
}

/**
 * @param {string[]} argv
 */
function gitSubcommand(argv) {
  if (baseName(argv[0]) !== 'git')
    return { invoked: false, name: '', args: [], cwd: '', configOverride: false }
  let i = 1
  let cwd = ''
  let configOverride = false
  while (i < argv.length) {
    const token = argv[i]
    if (token === '--')
      return { invoked: true, name: '', args: [], cwd, configOverride }
    if (token.startsWith('-')) {
      const opt = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      // -c and --config-env set config for this invocation. -C is a directory.
      if (opt === '-c' || opt === '--config-env' || (token.startsWith('-c') && !token.startsWith('-C')))
        configOverride = true
      if (opt === '-C' && !token.includes('='))
        cwd = argv[i + 1] ?? ''
      if (!token.includes('=') && GIT_OPTIONS_WITH_VALUE.has(opt))
        i += 2
      else
        i++
      continue
    }
    return { invoked: true, name: token, args: argv.slice(i + 1), cwd, configOverride }
  }
  return { invoked: true, name: '', args: [], cwd, configOverride }
}

/**
 * Local commit and push. Null means the command may run.
 * A cloud agent never reaches this; its commit and push stay unrestricted.
 * @param {{ name: string, args: string[], cwd: string, configOverride: boolean }} git
 * @param {{ currentBranch?: string, remotes?: string[], upstreamBranch?: string }} deps
 * @param {{ ci: boolean, gitConfigNames: Set<string> }} shell
 * @returns {string | null} denial text, or null when the write may run
 */
function localWriteProblem(git, deps, shell) {
  if (git.configOverride)
    return 'do not pass git -c or --config-env on git add, commit, or push.'
  if (shell.gitConfigNames.size > 0)
    return 'do not set GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT, or GIT_CONFIG_KEY_* for git add, commit, or push.'
  if (git.name === 'commit' && commitSkipsHooks(git.args))
    return 'do not skip git hooks with --no-verify or -n.'
  if (git.name === 'push' && pushSkipsHooks(git.args))
    return 'do not skip git hooks with --no-verify.'
  if (git.name === 'add' || git.name === 'commit') {
    const branch = resolveCurrentBranch(git.cwd, deps)
    if (!isWorkBranch(branch))
      return `git ${git.name} is allowed only on a feature/*, fix/*, or chore/* branch.`
    return null
  }
  if (git.name === 'push')
    return localPushProblem(git.args, git.cwd, deps)
  return null
}

/**
 * @param {string} branch
 */
function isWorkBranch(branch) {
  return WORK_BRANCH.test(branch)
}

/**
 * `git branch -D` and `git branch --delete --force`. Plain `-d` stays allowed.
 * @param {string[]} args
 */
function forceDeletesLocalBranch(args) {
  let deleting = false
  let force = false
  for (const token of args) {
    if (token === '--')
      break
    // -Dname is still a force delete. `--delete` starts with `--`, so it does not match.
    if (token === '-D' || /^-[A-Za-z]*D/.test(token))
      return true
    if (token === '-d' || token === '--delete')
      deleting = true
    if (token === '-f' || token === '--force')
      force = true
  }
  return deleting && force
}

/**
 * @param {string[]} args
 * @param {string} gitCwd
 * @param {{ currentBranch?: string, remotes?: string[], upstreamBranch?: string }} deps
 * @returns {string | null} denial text, or null when the push may run
 */
function localPushProblem(args, gitCwd, deps) {
  const refused = 'git push is allowed only to a feature/*, fix/*, or chore/* branch, and not with force or a remote delete.'
  /** @type {string[]} */
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (isForcePushFlag(token) || isBroadPushFlag(token))
      return refused
    if (token.startsWith('--')) {
      const opt = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (!token.includes('=') && PUSH_OPTIONS_WITH_VALUE.has(opt))
        i++
      continue
    }
    // Short cluster: -u is upstream, -f is force, -d deletes a remote branch.
    // -o takes a value, like --push-option. Letters after o are that value
    // (`-oci.skip`). Letters before o are flags (`-uo value`).
    if (token.startsWith('-')) {
      const cluster = token.slice(1)
      const optionAt = cluster.indexOf('o')
      const flags = optionAt === -1 ? cluster : cluster.slice(0, optionAt)
      if (/[fd]/i.test(flags))
        return refused
      if (optionAt !== -1 && cluster.slice(optionAt + 1) === '')
        i++
      continue
    }
    positionals.push(token)
  }

  const remotes = resolveRemotes(gitCwd, deps)
  let refspecs = positionals
  if (refspecs.length > 0 && remotes.includes(refspecs[0]))
    refspecs = refspecs.slice(1)

  if (refspecs.length === 0) {
    // No refspec: git updates the upstream branch when one exists, which can
    // differ from the local name. With no upstream, the current name is the
    // destination under the usual push.default.
    const upstream = resolveUpstreamBranch(gitCwd, deps)
    const destination = upstream || resolveCurrentBranch(gitCwd, deps)
    return isWorkBranch(destination) ? null : refused
  }

  for (const spec of refspecs) {
    if (!pushRefspecAllowed(spec, resolveCurrentBranch(gitCwd, deps)))
      return refused
  }
  return null
}

/**
 * @param {string} token
 */
function isForcePushFlag(token) {
  return token === '-f'
    || token === '--force'
    || token === '--force-if-includes'
    || token.startsWith('--force-with-lease')
}

/**
 * Pushes that are not one named work branch: every branch, tags, or a remote delete.
 * @param {string} token
 */
function isBroadPushFlag(token) {
  return token === '--all'
    || token === '--mirror'
    || token === '--tags'
    || token === '--follow-tags'
    || token === '--prune'
    || token === '--delete'
    || token.startsWith('--delete=')
    || token === '-d'
}

/**
 * @param {string} spec
 * @param {string} currentBranch
 */
function pushRefspecAllowed(spec, currentBranch) {
  if (spec.startsWith('+'))
    return false
  const colon = spec.indexOf(':')
  const src = colon === -1 ? spec : spec.slice(0, colon)
  const dst = colon === -1 ? spec : spec.slice(colon + 1)
  // An empty side deletes the remote branch (`:name` or `name:`).
  if (src === '' || dst === '')
    return false
  return destinationIsWorkBranch(dst, currentBranch)
}

/**
 * @param {string} dst
 * @param {string} currentBranch
 */
function destinationIsWorkBranch(dst, currentBranch) {
  if (dst === 'HEAD')
    return isWorkBranch(currentBranch)
  if (dst.startsWith('refs/heads/'))
    return isWorkBranch(dst.slice('refs/heads/'.length))
  if (dst.startsWith('refs/'))
    return false
  return isWorkBranch(dst)
}

/**
 * Tests pass `currentBranch` so they do not depend on this checkout.
 * Otherwise ask git. A failure denies the write (empty name is not a work branch).
 * @param {string} gitCwd
 * @param {{ currentBranch?: string }} deps
 */
function resolveCurrentBranch(gitCwd, deps) {
  if (typeof deps.currentBranch === 'string')
    return deps.currentBranch
  return readGitLine(gitCwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

/**
 * Branch name on the remote, without the remote prefix. Empty when unset.
 * Tests pass `upstreamBranch` so they do not read this checkout's tracking ref.
 * @param {string} gitCwd
 * @param {{ upstreamBranch?: string }} deps
 */
function resolveUpstreamBranch(gitCwd, deps) {
  if (typeof deps.upstreamBranch === 'string')
    return deps.upstreamBranch
  const text = readGitLine(gitCwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  if (!text)
    return ''
  const slash = text.indexOf('/')
  return slash === -1 ? text : text.slice(slash + 1)
}

/**
 * @param {string} gitCwd
 * @param {{ remotes?: string[] }} deps
 */
function resolveRemotes(gitCwd, deps) {
  if (Array.isArray(deps.remotes))
    return deps.remotes
  const text = readGitText(gitCwd, ['remote'])
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

/**
 * @param {string} gitCwd
 * @param {string[]} args
 */
function readGitLine(gitCwd, args) {
  return readGitText(gitCwd, args).trim()
}

/**
 * @param {string} gitCwd
 * @param {string[]} args
 */
function readGitText(gitCwd, args) {
  const gitArgs = gitCwd ? ['-C', gitCwd, ...args] : args
  const result = spawnSync('git', gitArgs, { encoding: 'utf8' })
  if (result.status !== 0)
    return ''
  return result.stdout ?? ''
}

/**
 * `git checkout -b <name>` or `git switch -c <name>`, and not `-B` or `-C`.
 * The name is the next word. A start-point after the name is still a create.
 * @param {string} subcommand
 * @param {string[]} args
 */
function createsNewBranch(subcommand, args) {
  const flag = subcommand === 'checkout' ? '-b' : subcommand === 'switch' ? '-c' : ''
  if (!flag)
    return false
  let named = false
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--')
      break
    // -B / -C (and -Bname / -Cname) reset an existing branch. Never a create.
    if (token === '-B' || token === '-C' || token.startsWith('-B') || token.startsWith('-C'))
      return false
    if (token === flag) {
      const name = args[i + 1]
      if (!name || name === '--' || name.startsWith('-'))
        return false
      named = true
      i++
    }
  }
  return named
}

/**
 * @param {string[]} argv
 */
function removesProtected(argv) {
  const name = baseName(argv[0])
  if (REMOVERS.has(name))
    return operands(argv).some(isProtectedPath)
  if (name !== 'find')
    return false
  const deletes = argv.includes('-delete') || argv.includes('-exec') || argv.includes('-execdir')
  return deletes && argv.some(isProtectedPath)
}

/**
 * @param {string[]} argv
 */
function readsSecretEnv(argv) {
  if (!READERS.has(baseName(argv[0])))
    return false
  return argv.slice(1).some(isEnvFileToken)
}

/**
 * Flags stay. Everything after `--` is an operand, including a leading dash.
 * @param {string[]} argv
 */
function operands(argv) {
  /** @type {string[]} */
  const found = []
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--') {
      found.push(...argv.slice(i + 1))
      break
    }
    if (!token.startsWith('-'))
      found.push(token)
  }
  return found
}

/**
 * @param {string} token
 */
function isEnvFileToken(token) {
  if (token === '--' || (token.startsWith('-') && !token.includes('=')))
    return false
  const value = token.startsWith('-') ? token.slice(token.indexOf('=') + 1) : token
  return isEnvPath(value)
}

/**
 * `.env.example` is committed sample text. Every other `.env` name is a secret file.
 * @param {string} filePath
 */
function isEnvPath(filePath) {
  const base = filePath.split(/[/\\]/).pop() ?? ''
  if (base === '.env.example')
    return false
  return base === '.env' || base.startsWith('.env.')
}

/**
 * node_modules, a path inside it, or the pnpm modules file.
 * @param {string} token
 */
function isProtectedPath(token) {
  const normalized = token.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalized === 'node_modules' || normalized.endsWith('/node_modules'))
    return true
  if (normalized === '.modules.yaml' || normalized.endsWith('/.modules.yaml'))
    return true
  return normalized.startsWith('node_modules/') || normalized.includes('/node_modules/')
}

/**
 * @param {string} token
 */
function isAssignment(token) {
  return /^[A-Z_]\w*=/i.test(token)
}

/**
 * Git's env override of config. A prefix or an earlier `export` both count.
 * @param {string} name
 */
function isGitConfigEnv(name) {
  return name === 'GIT_CONFIG_PARAMETERS'
    || name === 'GIT_CONFIG_COUNT'
    || name.startsWith('GIT_CONFIG_KEY_')
}

/**
 * Prefix assignments apply to this command only. The parent shell is copied.
 * @param {{ ci: boolean, gitConfigNames: Set<string> }} shell
 * @param {string[]} assignments
 */
function shellAfterAssignments(shell, assignments) {
  const next = {
    ci: shell.ci,
    gitConfigNames: new Set(shell.gitConfigNames),
  }
  for (const token of assignments)
    applyConfigAssignment(next, token)
  return next
}

/**
 * @param {{ ci: boolean, gitConfigNames: Set<string> }} shell
 * @param {string} token
 */
function applyConfigAssignment(shell, token) {
  const eq = token.indexOf('=')
  const key = token.slice(0, eq)
  const value = token.slice(eq + 1)
  if (key === 'CI')
    shell.ci = value === '1'
  if (isGitConfigEnv(key))
    shell.gitConfigNames.add(key)
}

/**
 * `export` lasts for the rest of this shell. `unset` clears it.
 * A bare assignment in front of a command does not reach here.
 * @param {string} statement
 * @param {{ ci: boolean, gitConfigNames: Set<string> }} shell
 */
function recordExports(statement, shell) {
  const tokens = tokenize(statement)
  if (tokens.length === 0)
    return
  const name = baseName(tokens[0])
  if (name === 'export') {
    for (const token of tokens.slice(1)) {
      if (!isAssignment(token))
        continue
      applyConfigAssignment(shell, token)
    }
    return
  }
  if (name !== 'unset')
    return
  for (const key of tokens.slice(1)) {
    if (key === '--')
      break
    if (key.startsWith('-'))
      continue
    if (key === 'CI')
      shell.ci = false
    if (isGitConfigEnv(key))
      shell.gitConfigNames.delete(key)
  }
}

/**
 * Commit `-n` is `--no-verify`. A message attached to `-m` is not that flag.
 * @param {string[]} args
 */
function commitSkipsHooks(args) {
  const messageOptions = new Set(['--message', '--file', '--author', '--date', '--template'])
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--')
      break
    if (token === '--no-verify' || token.startsWith('--no-verify='))
      return true
    // The next word is the message, even when it looks like --no-verify.
    if (messageOptions.has(token)) {
      i++
      continue
    }
    if (!token.startsWith('-') || token.startsWith('--'))
      continue
    const cluster = token.slice(1)
    // -m, -F, -C, -c, and -t take a message. Letters after the first of those are the message.
    const valueAt = cluster.search(/[mFCct]/)
    const flags = valueAt === -1 ? cluster : cluster.slice(0, valueAt)
    if (flags.includes('n'))
      return true
    if (valueAt !== -1 && cluster.slice(valueAt + 1) === '')
      i++
  }
  return false
}

/**
 * Push `-n` is dry-run. Only the long flag skips the pre-push hook.
 * @param {string[]} args
 */
function pushSkipsHooks(args) {
  for (const token of args) {
    if (token === '--')
      break
    if (token === '--no-verify' || token.startsWith('--no-verify='))
      return true
  }
  return false
}

/**
 * `git config name` reads. `git config name value` writes. So does --unset / --edit.
 * A read flag such as `--get` wins unless a write flag is also present.
 * @param {string[]} args
 */
function gitConfigWrites(args) {
  /** @type {string[]} */
  const positionals = []
  let read = false
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (token.startsWith('-')) {
      const opt = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (CONFIG_WRITE_FLAGS.has(opt))
        return true
      if (CONFIG_READ_FLAGS.has(opt))
        read = true
      if (!token.includes('=') && CONFIG_OPTIONS_WITH_VALUE.has(opt))
        i++
      continue
    }
    positionals.push(token)
  }
  if (read)
    return false
  return positionals.length >= 2
}

/**
 * @param {string} commandName
 */
function isPnpmInstall(commandName) {
  return commandName === 'install' || commandName === 'i'
}

/**
 * The pnpm subcommand, after flags. Empty when the line is only flags.
 * @param {string[]} argv
 */
function pnpmCommandName(argv) {
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--')
      return argv[i + 1] ?? ''
    if (token.startsWith('-')) {
      const opt = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (!token.includes('=') && PNPM_OPTIONS_WITH_VALUE.has(opt))
        i++
      continue
    }
    return token
  }
  return ''
}

/**
 * @param {string} token
 */
function baseName(token) {
  const name = token.split(/[/\\]/).pop() ?? token
  return name.toLowerCase().endsWith('.exe') ? name.slice(0, -4) : name
}

/**
 * @param {string} filePath
 */
function isSocket(filePath) {
  try {
    return fs.statSync(filePath).isSocket()
  }
  catch {
    return false
  }
}

function allow() {
  return { permission: 'allow' }
}

/**
 * @param {string} reason
 * @param {string} command
 */
function deny(reason, command) {
  const shown = command.length > 160 ? `${command.slice(0, 160)}…` : command
  const message = shown
    ? `Blocked by the transferpro shell guard: ${reason} Command: ${shown}`
    : `Blocked by the transferpro shell guard: ${reason}`
  return {
    permission: 'deny',
    user_message: message,
    agent_message: message,
  }
}

async function main() {
  const chunks = []
  for await (const chunk of process.stdin)
    chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')

  /** @type {{ command?: unknown, conversation_id?: unknown }} */
  let input
  try {
    input = JSON.parse(raw)
  }
  catch {
    process.stdout.write(`${JSON.stringify(deny('the hook input was not JSON.', ''))}\n`)
    return
  }

  const command = typeof input.command === 'string' ? input.command : ''
  const conversationId = typeof input.conversation_id === 'string' ? input.conversation_id : ''
  const verdict = command ? decide(command, process.env, 0, { conversationId }) : allow()
  process.stdout.write(`${JSON.stringify(verdict)}\n`)
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'hook failed'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
