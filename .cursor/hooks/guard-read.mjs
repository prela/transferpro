/**
 * beforeReadFile policy for transferpro.
 *
 * Cursor sends one JSON object on stdin (`file_path`, and the file contents)
 * and expects `{ permission: "allow" | "deny", user_message? }`.
 * hooks.json sets failClosed, so a crash or invalid JSON denies the read.
 * A self-hosted worker does not honour `.cursorignore` for the file-read tool,
 * so this hook is what stops `.env`, keys, and `~/.ssh` from reaching the model.
 */
import { Buffer } from 'node:buffer'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/**
 * @param {string} filePath
 * @param {{ home?: string }} [deps]
 */
export function decideRead(filePath, deps = {}) {
  if (typeof filePath !== 'string' || filePath === '')
    return deny()
  const normalized = path.posix.normalize(filePath.replaceAll('\\', '/'))
  const home = path.posix.normalize((deps.home ?? os.homedir()).replaceAll('\\', '/'))
  if (isSecretFile(normalized, home))
    return deny()
  return { permission: 'allow' }
}

/**
 * `.env` and `.env.*` except names ending in `.example`. `*.pem` and `*.key`.
 * Anything under the home `.ssh` directory, including after `..` is folded.
 * @param {string} filePath
 * @param {string} home
 */
function isSecretFile(filePath, home) {
  const base = filePath.split('/').pop() ?? ''
  if (base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example')))
    return true
  if (base.endsWith('.pem') || base.endsWith('.key'))
    return true
  const ssh = `${home.replace(/\/$/, '')}/.ssh`
  const cleaned = filePath.replace(/\/$/, '')
  return cleaned === ssh || cleaned.startsWith(`${ssh}/`)
}

function deny() {
  return {
    permission: 'deny',
    user_message: 'Blocked by the transferpro read guard: do not read secret files (.env, .pem, .key, or ~/.ssh).',
  }
}

async function main() {
  const chunks = []
  for await (const chunk of process.stdin)
    chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')

  /** @type {{ file_path?: unknown }} */
  let input
  try {
    input = JSON.parse(raw)
  }
  catch {
    process.stdout.write(`${JSON.stringify(deny())}\n`)
    return
  }

  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  process.stdout.write(`${JSON.stringify(decideRead(filePath))}\n`)
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'hook failed'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
