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
 * The same gate allows commit, push, and `git checkout -b` / `git switch -c`.
 * A prefix on the command does not count: the agent could add it itself.
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const ALWAYS_BLOCKED_GIT = new Set(['reset', 'checkout', 'stash', 'switch', 'restore'])
const COMMIT_OR_PUSH = new Set(['commit', 'push'])
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
 * @param {{ isSocket?: (path: string) => boolean, conversationId?: string }} [deps]
 */
export function decide(command, env = process.env, depth = 0, deps = {}) {
  if (depth > MAX_DEPTH) {
    return deny(
      'nested shell commands are too deep to inspect.',
      command,
    )
  }

  for (const statement of splitStatements(command)) {
    const verdict = inspectStatement(statement, env, depth, deps)
    if (verdict.permission === 'deny')
      return verdict
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
 * @param {{ isSocket?: (path: string) => boolean, conversationId?: string }} deps
 */
function inspectStatement(statement, env, depth, deps) {
  const unwrapped = unwrap(tokenize(statement))
  if (unwrapped.script)
    return decide(unwrapped.script, env, depth + 1, deps)
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
    return decide(inline, env, depth + 1, deps)

  const git = gitSubcommand(argv)
  if (git.invoked) {
    // checkout -b and switch -c create a branch. -B and -C reset one that
    // already exists, so they stay denied. Same gate as commit and push.
    const creating = createsNewBranch(git.name, git.args) && gitWritesAllowed(env, deps)
    if (ALWAYS_BLOCKED_GIT.has(git.name) && !creating) {
      return deny(
        `do not run git ${git.name}. The human does that.`,
        statement,
      )
    }
    if (COMMIT_OR_PUSH.has(git.name) && !gitWritesAllowed(env, deps)) {
      return deny(
        'do not run git commit or git push. The human commits. A cloud agent may commit and push.',
        statement,
      )
    }
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
  for (let hop = 0; hop < 8; hop++) {
    while (argv.length > 0 && isAssignment(argv[0]))
      argv = argv.slice(1)
    if (argv.length === 0)
      return { argv, script: null, envDump: false }

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
        return { argv: [], script: null, envDump: true }
      if (parsed.kind === 'script')
        return { argv: [], script: parsed.script, envDump: false }
      argv = parsed.argv
      continue
    }
    return { argv, script: null, envDump: false }
  }
  return { argv, script: null, envDump: false }
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
 * @returns {{ kind: 'dump' } | { kind: 'script', script: string } | { kind: 'command', argv: string[] }} dump, inline script, or the remaining command
 */
function parseEnv(tokens) {
  let i = 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === '--') {
      i++
      break
    }
    if (isAssignment(token)) {
      i++
      continue
    }
    if (token === '-S' || token === '--split-string') {
      return { kind: 'script', script: tokens[i + 1] ?? '' }
    }
    if (token.startsWith('-')) {
      const opt = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (!token.includes('=') && ENV_OPTIONS_WITH_VALUE.has(opt))
        i += 2
      else
        i++
      continue
    }
    return { kind: 'command', argv: tokens.slice(i) }
  }
  return { kind: 'dump' }
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
    return { invoked: false, name: '', args: [] }
  let i = 1
  while (i < argv.length) {
    const token = argv[i]
    if (token === '--')
      return { invoked: true, name: '', args: [] }
    if (token.startsWith('-')) {
      const opt = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
      if (!token.includes('=') && GIT_OPTIONS_WITH_VALUE.has(opt))
        i += 2
      else
        i++
      continue
    }
    return { invoked: true, name: token, args: argv.slice(i + 1) }
  }
  return { invoked: true, name: '', args: [] }
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
