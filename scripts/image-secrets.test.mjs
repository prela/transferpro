import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'vitest'
import { collectImageSecretLeaks, SECRET_BUILD_NAMES } from './image-secrets.mjs'

const sentinel = 'tp497-sentinel-value-not-real'

const cleanDockerfile = `
# Runtime only. Do not declare ARG BETTER_AUTH_SECRET or the other secret names.
FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN echo build
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
`

const cleanHistory = `ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
CMD ["node" ".output/server/index.mjs"]
`

/**
 * @param {string} dockerfile
 * @param {string} history
 * @param {{ path: string, body: string }[]} files
 * @param {readonly string[]} [values]
 */
function leaks(dockerfile, history, files, values = [sentinel]) {
  const root = mkdtempSync(join(tmpdir(), 'image-secrets-'))
  for (const file of files) {
    const path = join(root, file.path)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, file.body)
  }
  return collectImageSecretLeaks({
    dockerfile,
    history,
    outputRoot: root,
    values,
  })
}

it('names the Coolify secrets that must stay off the build', () => {
  assert.deepEqual(SECRET_BUILD_NAMES, [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'AUTH_DATABASE_URL',
    'MAPS_API_KEY',
    'MAPS_EMBED_KEY',
    'INVOICING_SECRET_KEY',
  ])
})

it('accepts a runtime image that only sets NODE_ENV, HOST, and PORT', () => {
  const found = leaks(cleanDockerfile, cleanHistory, [
    { path: 'server/chunk.mjs', body: 'const secret = source.BETTER_AUTH_SECRET' },
  ])
  assert.deepEqual(found, [])
})

it('fails when the Dockerfile declares a secret ARG or ENV', () => {
  const found = leaks(`${cleanDockerfile}\nARG BETTER_AUTH_SECRET\nENV MAPS_API_KEY=placeholder\n`, cleanHistory, [])
  assert.equal(found.some(line => line.includes('BETTER_AUTH_SECRET') && line.includes('Dockerfile')), true)
  assert.equal(found.some(line => line.includes('MAPS_API_KEY') && line.includes('Dockerfile')), true)
  assert.equal(found.some(line => line.includes('placeholder')), false)
})

it('fails when docker history records a secret name and does not echo the value', () => {
  const found = leaks(cleanDockerfile, `${cleanHistory}\nENV AUTH_DATABASE_URL=postgres://auth:super-secret@db/app\n`, [])
  assert.equal(found.some(line => line.includes('AUTH_DATABASE_URL') && line.includes('history')), true)
  assert.equal(found.some(line => line.includes('super-secret')), false)
  assert.equal(found.some(line => line.includes('postgres://')), false)
})

it('fails when a secret value is in the built output and does not echo it', () => {
  const found = leaks(cleanDockerfile, cleanHistory, [
    { path: 'server/chunk.mjs', body: `const baked = "${sentinel}"` },
  ])
  assert.equal(found.length, 1)
  assert.match(found[0], /server\/chunk\.mjs/)
  assert.equal(found[0].includes(sentinel), false)
})

it('fails when a secret value is in docker history and does not echo it', () => {
  const found = leaks(cleanDockerfile, `${cleanHistory}\nRUN echo ${sentinel}\n`, [])
  assert.equal(found.some(line => line.includes('history')), true)
  assert.equal(found.some(line => line.includes(sentinel)), false)
})

it('fails when a secret name is in the client bundle', () => {
  const found = leaks(cleanDockerfile, cleanHistory, [
    { path: 'public/app.js', body: 'window.MAPS_EMBED_KEY' },
  ])
  assert.equal(found.some(line => line.includes('MAPS_EMBED_KEY') && line.includes('public/app.js')), true)
})

it('the command exits 1 and does not echo the secret value', () => {
  const root = mkdtempSync(join(tmpdir(), 'image-secrets-cli-'))
  const output = join(root, 'output')
  mkdirSync(output)
  writeFileSync(join(output, 'chunk.mjs'), `baked ${sentinel}`)
  writeFileSync(join(root, 'Dockerfile'), cleanDockerfile)
  writeFileSync(join(root, 'history.txt'), cleanHistory)
  writeFileSync(join(root, 'values.txt'), `${sentinel}\n`)
  const result = spawnSync(process.execPath, [
    join(process.cwd(), 'scripts/assert-image-secrets.mjs'),
    '--dockerfile',
    join(root, 'Dockerfile'),
    '--output',
    output,
    '--history-file',
    join(root, 'history.txt'),
    '--values-file',
    join(root, 'values.txt'),
  ], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /chunk\.mjs/)
  assert.equal(result.stderr.includes(sentinel), false)
  assert.equal(result.stdout.includes(sentinel), false)
})
