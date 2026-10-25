/**
 * Fails when a preview secret is a build `ARG`/`ENV`, shows up in
 * `docker history`, or is baked into `.output`. Messages never include values.
 *
 *   node scripts/assert-image-secrets.mjs \
 *     --dockerfile Dockerfile \
 *     --output .output \
 *     --history-file history.txt \
 *     --values-file sentinels.txt
 *
 * `--image NAME` runs `docker history --no-trunc` and copies `/app/.output`
 * out of a created (not started) container.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { collectImageSecretLeaks } from './image-secrets.mjs'

/**
 * @param {string[]} argv
 * @returns {Record<string, string>} Flag name to the following argument.
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('--'))
      throw new Error('assert-image-secrets: unexpected argument.')
    const key = token.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--'))
      throw new Error(`assert-image-secrets: ${token} needs a value.`)
    args[key] = value
    index += 1
  }
  return args
}

/**
 * @param {string} image
 */
function historyFromImage(image) {
  const result = spawnSync('docker', ['history', '--no-trunc', '--format', '{{.CreatedBy}}', image], {
    encoding: 'utf8',
  })
  if (result.status !== 0)
    throw new Error('docker history failed.')
  return result.stdout
}

/**
 * The container is created and removed. It is not started, so it does not
 * read runtime secrets.
 *
 * The copy lands in the working directory. Docker Desktop's CLI does not
 * see a WSL `/tmp`, and `docker cp` then reports that the directory does
 * not exist.
 *
 * @param {string} image
 * @param {string} destination Directory that will hold the copied `.output`.
 */
function copyOutputFromImage(image, destination) {
  const created = spawnSync('docker', ['create', image], { encoding: 'utf8' })
  if (created.status !== 0)
    throw new Error('docker create failed.')
  const container = created.stdout.trim()
  try {
    const copied = spawnSync('docker', ['cp', `${container}:/app/.output`, destination], { encoding: 'utf8' })
    if (copied.status !== 0)
      throw new Error('docker cp of /app/.output failed.')
  }
  finally {
    spawnSync('docker', ['rm', container], { encoding: 'utf8' })
  }
}

/**
 * @param {string | undefined} path
 * @returns {string[]} Trimmed lines, skipping blanks and comments.
 */
function readValues(path) {
  if (path === undefined)
    return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

/**
 * @param {string[]} argv
 * @returns {string[]} Findings. Empty when the image is clean.
 */
export function assertImageSecrets(argv) {
  const args = parseArgs(argv)
  const dockerfilePath = args.dockerfile ?? 'Dockerfile'
  const values = readValues(args['values-file'])
  let history = ''
  let outputRoot = args.output
  /** @type {string | undefined} */
  let scratch
  if (args.image !== undefined) {
    history = historyFromImage(args.image)
    scratch = mkdtempSync(join(process.cwd(), '.image-secret-scan-'))
    copyOutputFromImage(args.image, join(scratch, 'output'))
    outputRoot = join(scratch, 'output')
  }
  else if (args['history-file'] !== undefined) {
    history = readFileSync(args['history-file'], 'utf8')
  }
  else {
    throw new Error('assert-image-secrets: pass --history-file or --image.')
  }
  if (outputRoot === undefined)
    throw new Error('assert-image-secrets: pass --output or --image.')
  try {
    return collectImageSecretLeaks({
      dockerfile: readFileSync(dockerfilePath, 'utf8'),
      history,
      outputRoot,
      values,
    })
  }
  finally {
    if (scratch !== undefined)
      rmSync(scratch, { recursive: true, force: true })
  }
}

const entry = process.argv[1]
const isEntry = entry !== undefined && import.meta.url === pathToFileURL(entry).href

if (isEntry) {
  try {
    const found = assertImageSecrets(process.argv.slice(2))
    if (found.length > 0) {
      process.stderr.write(`${found.join('\n')}\n`)
      process.exit(1)
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'image secret check failed.'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
