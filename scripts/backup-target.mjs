/**
 * Backup and restore connection targets.
 * The restore URL is refused when it names the source database on the same
 * host. A second database name on that host is allowed: the local proof
 * restores there. The preview database itself is not.
 */
import { chmodSync, realpathSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const noNewline = z.string().refine(value => !/[\r\n]/.test(value))
const connectionSchema = z.object({
  host: z.string().min(1),
  port: z.string().regex(/^\d+$/),
  database: z.string().regex(/^[A-Z_]\w*$/i),
  user: noNewline.pipe(z.string().min(1)),
  password: noNewline,
  sslmode: z.string().nullable(),
})

/**
 * @param {string} raw
 * @returns {{ host: string, port: string, database: string, user: string, password: string, sslmode: string | null }} Parsed target. Errors omit the password.
 */
export function databaseIdentity(raw) {
  const text = z.string().min(1).safeParse(raw)
  if (!text.success)
    throw new Error('database URL is not valid')

  let url
  try {
    url = new URL(text.data)
  }
  catch {
    throw new Error('database URL is not valid')
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new Error('database URL must use postgres')

  let host = url.hostname.toLowerCase()
  if (host === 'localhost')
    host = '127.0.0.1'

  const checked = connectionSchema.safeParse({
    host,
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslmode: url.searchParams.get('sslmode'),
  })
  if (!checked.success)
    throw new Error('database URL is not valid')
  return checked.data
}

/**
 * @param {string} sourceRaw
 * @param {string} targetRaw
 */
export function assertIsolatedRestore(sourceRaw, targetRaw) {
  const source = databaseIdentity(sourceRaw)
  const target = databaseIdentity(targetRaw)
  if (source.host === target.host && source.database === target.database)
    throw new Error('restore target is the source database')
}

/**
 * Two files because Docker's env-file is not shell syntax.
 * Callers delete the directory that holds them.
 *
 * @param {string} raw
 * @param {string} shellFile sourced by a host pg client
 * @param {string} dockerEnvFile passed to `docker run --env-file`
 */
export function writeConnectionFiles(raw, shellFile, dockerEnvFile) {
  const identity = databaseIdentity(raw)
  /** @type {Array<[string, string]>} */
  const lines = [
    ['PGHOST', identity.host],
    ['PGPORT', identity.port],
    ['PGUSER', identity.user],
    ['PGDATABASE', identity.database],
    ['PGPASSWORD', identity.password],
  ]
  if (identity.sslmode)
    lines.push(['PGSSLMODE', identity.sslmode])

  const shell = lines.map(([key, value]) => `${key}=${shellQuote(value)}`).join('\n')
  const docker = lines.map(([key, value]) => `${key}=${value}`).join('\n')
  writeFileSync(shellFile, `${shell}\n`, { mode: 0o600 })
  writeFileSync(dockerEnvFile, `${docker}\n`, { mode: 0o600 })
  chmodSync(shellFile, 0o600)
  chmodSync(dockerEnvFile, 0o600)
}

/**
 * @param {string} value
 */
function shellQuote(value) {
  return `'${value.replaceAll('\'', `'\\''`)}'`
}

function isCli() {
  const invoked = process.argv[1]
  if (!invoked)
    return false
  return pathToFileURL(realpathSync(invoked)).href === import.meta.url
}

if (isCli()) {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === 'check')
      assertIsolatedRestore(args[0] ?? '', args[1] ?? '')
    else if (command === 'env')
      writeConnectionFiles(args[0] ?? '', args[1] ?? '', args[2] ?? '')
    else
      throw new Error('usage: backup-target.mjs check|env')
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'backup target failed'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
