/**
 * The preview image must not receive these as build `ARG`s or `ENV`s.
 * Coolify reads them at container start. `nuxi build` does not.
 *
 * The server bundle still spells the names: `parseAppEnv` reads them from
 * `process.env` at boot. That string is not a value. The client bundle
 * (`.output/public`) must not spell them either.
 *
 * Findings name the variable or the file. They never include a value.
 */
import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Issue #497. BuildKit treats these names as secrets. */
export const SECRET_BUILD_NAMES = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'AUTH_DATABASE_URL',
  'MAPS_API_KEY',
  'MAPS_EMBED_KEY',
  'INVOICING_SECRET_KEY',
]

/** Shorter needles match ordinary words. Callers pass the real values. */
const MIN_VALUE_LENGTH = 8

/**
 * @param {string} name
 */
function namePattern(name) {
  return new RegExp(`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`)
}

/**
 * Instruction text only. A comment may name the variable so the Dockerfile
 * can say why it is absent.
 *
 * @param {string} dockerfile
 * @returns {string[]} Findings. Each one names the variable.
 */
function dockerfileLeaks(dockerfile) {
  /** @type {string[]} */
  const found = []
  for (const raw of dockerfile.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '')
      continue
    for (const name of SECRET_BUILD_NAMES) {
      const declared = new RegExp(`^(?:ARG|ENV)\\s+${name}(?![A-Z0-9_])`)
      const laterEnv = new RegExp(`^ENV\\s+\\S+\\s+${name}(?![A-Z0-9_])`)
      if (!declared.test(line) && !laterEnv.test(line))
        continue
      found.push(`Dockerfile declares ${name}. Secrets are runtime only.`)
    }
  }
  return found
}

/**
 * @param {string} history `docker history --no-trunc` text.
 * @param {readonly string[]} values
 * @returns {string[]} Findings. A value hit does not repeat the value.
 */
function historyLeaks(history, values) {
  /** @type {string[]} */
  const found = []
  for (const name of SECRET_BUILD_NAMES) {
    if (namePattern(name).test(history))
      found.push(`docker history records ${name}. Secrets are runtime only.`)
  }
  if (values.some(value => history.includes(value)))
    found.push('docker history contains a secret value.')
  return found
}

/**
 * @param {string} outputRoot
 * @param {readonly string[]} values
 * @returns {string[]} Findings. A value hit names the file only.
 */
function outputLeaks(outputRoot, values) {
  /** @type {string[]} */
  const found = []
  /** @param {string} directory */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.isFile())
        continue
      const body = readFileSync(path)
      const rel = relative(outputRoot, path).split(sep).join('/')
      if (values.some(value => body.includes(Buffer.from(value))))
        found.push(`built output contains a secret value in ${rel}.`)
      const client = rel === 'public' || rel.startsWith('public/')
      if (!client)
        continue
      const text = body.toString('utf8')
      for (const name of SECRET_BUILD_NAMES) {
        if (namePattern(name).test(text))
          found.push(`client output names ${name} in ${rel}.`)
      }
    }
  }
  if (!statSync(outputRoot, { throwIfNoEntry: false })?.isDirectory())
    throw new Error('built output is missing.')
  walk(outputRoot)
  return found
}

/**
 * @param {{
 *   dockerfile: string
 *   history: string
 *   outputRoot: string
 *   values?: readonly string[]
 * }} input
 * @returns {string[]} Findings. Empty when the image is clean.
 */
export function collectImageSecretLeaks(input) {
  const values = input.values ?? []
  for (const value of values) {
    if (value.length < MIN_VALUE_LENGTH)
      throw new Error('a secret value is shorter than 8 characters.')
  }
  return [
    ...dockerfileLeaks(input.dockerfile),
    ...historyLeaks(input.history, values),
    ...outputLeaks(input.outputRoot, values),
  ]
}
