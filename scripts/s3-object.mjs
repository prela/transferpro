/**
 * S3 put, get, list, and delete for the backup object.
 * Cloudflare R2 takes this API with region `auto` and a path-style endpoint.
 * The signer is checked against the published AWS SigV4 GET Object example.
 */
import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

/** Owner decision on #234: daily copies kept for 14 days, no weekly tier. */
export const DAILY_RETENTION_DAYS = 14

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const DAILY_OBJECT = /^\d{8}T\d{6}Z\.dump\.gpg$/

const envSchema = z.object({
  BACKUP_S3_BUCKET: z.string().min(1),
  BACKUP_S3_ENDPOINT: z.string().min(1),
  BACKUP_S3_REGION: z.string().min(1).default('auto'),
  BACKUP_S3_PREFIX: z.string().regex(/^[A-Z0-9][\w./-]*$/i).refine(
    value => !value.includes('..') && !value.endsWith('/'),
    'BACKUP_S3_PREFIX is invalid',
  ).default('daily'),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
})

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function loadBackupS3Env(env = process.env) {
  const parsed = envSchema.safeParse({
    BACKUP_S3_BUCKET: env.BACKUP_S3_BUCKET,
    BACKUP_S3_ENDPOINT: blankToUndefined(env.BACKUP_S3_ENDPOINT),
    BACKUP_S3_REGION: blankToUndefined(env.BACKUP_S3_REGION),
    BACKUP_S3_PREFIX: blankToUndefined(env.BACKUP_S3_PREFIX),
    AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY,
  })
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].join(', ')
    throw new Error(`backup S3 settings are invalid: ${fields}`)
  }

  let endpoint
  try {
    endpoint = new URL(parsed.data.BACKUP_S3_ENDPOINT)
  }
  catch {
    throw new Error('backup S3 settings are invalid: BACKUP_S3_ENDPOINT')
  }
  if (endpoint.username !== '' || endpoint.password !== '' || endpoint.pathname !== '/' || endpoint.search !== '')
    throw new Error('BACKUP_S3_ENDPOINT is the origin only')
  if (endpoint.protocol !== 'https:' && env.BACKUP_S3_ALLOW_HTTP !== '1')
    throw new Error('BACKUP_S3_ENDPOINT must use https')

  return {
    bucket: parsed.data.BACKUP_S3_BUCKET,
    endpoint,
    region: parsed.data.BACKUP_S3_REGION,
    prefix: parsed.data.BACKUP_S3_PREFIX,
    accessKeyId: parsed.data.AWS_ACCESS_KEY_ID,
    secretAccessKey: parsed.data.AWS_SECRET_ACCESS_KEY,
  }
}

/**
 * @param {string | undefined} value
 */
function blankToUndefined(value) {
  if (value === undefined || value === '')
    return undefined
  return value
}

/**
 * @param {string} value
 */
function encodeRfc3986(value) {
  return encodeURIComponent(value).replaceAll(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  })
}

/**
 * @param {Date} now
 */
export function amzDates(now) {
  const amzDate = now.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

/**
 * @param {string} prefix
 * @param {Date} now
 */
export function backupObjectKey(prefix, now) {
  return `${prefix}/${amzDates(now).amzDate}.dump.gpg`
}

/**
 * @param {string} prefix
 * @param {string} key
 */
export function isDailyBackupKey(prefix, key) {
  if (!key.startsWith(`${prefix}/`))
    return false
  return DAILY_OBJECT.test(key.slice(prefix.length + 1))
}

/**
 * @param {Array<{ key: string, lastModified: Date }>} objects
 * @param {Date} now
 * @param {string} prefix
 */
export function keysToPrune(objects, now, prefix) {
  const cutoff = now.getTime() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000
  return objects
    .filter(object => isDailyBackupKey(prefix, object.key))
    .filter(object => object.lastModified.getTime() <= cutoff)
    .map(object => object.key)
}

/**
 * @param {Array<{ key: string, lastModified: Date }>} objects
 * @param {string} prefix
 */
export function latestDailyKey(objects, prefix) {
  const daily = objects.filter(object => isDailyBackupKey(prefix, object.key))
  if (daily.length === 0)
    throw new Error('no daily backup in the bucket')
  daily.sort((left, right) => right.lastModified.getTime() - left.lastModified.getTime())
  const latest = daily[0]
  if (!latest)
    throw new Error('no daily backup in the bucket')
  return latest.key
}

/**
 * @param {URL} url
 */
function canonicalUri(url) {
  return url.pathname.split('/').map(segment => encodeRfc3986(decodeURIComponent(segment))).join('/')
}

/**
 * @param {URLSearchParams} params
 */
function canonicalQuery(params) {
  return [...params.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

/**
 * @param {string} value
 */
function canonicalHeaderValue(value) {
  return value.trim().replaceAll(/\s+/g, ' ')
}

/**
 * Published-vector shape. `headers` are extra signed headers such as range.
 *
 * @param {{
 *   method: string,
 *   url: URL,
 *   headers?: Record<string, string>,
 *   payloadHash: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   region: string,
 *   now: Date,
 * }} input
 */
export function signAwsRequest(input) {
  const { amzDate, dateStamp } = amzDates(input.now)
  const headers = new Map([
    ['host', input.url.host],
    ['x-amz-content-sha256', input.payloadHash],
    ['x-amz-date', amzDate],
  ])
  for (const [name, value] of Object.entries(input.headers ?? {}))
    headers.set(name.toLowerCase(), value)

  const names = [...headers.keys()].sort()
  const canonicalHeaders = names.map((name) => {
    return `${name}:${canonicalHeaderValue(headers.get(name) ?? '')}\n`
  }).join('')
  const signedHeaders = names.join(';')
  const canonical = [
    input.method,
    canonicalUri(input.url),
    canonicalQuery(input.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n')
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonical).digest('hex'),
  ].join('\n')
  // HMAC chain from the SigV4 spec: each step's raw digest is the next key.
  const dateKey = createHmac('sha256', `AWS4${input.secretAccessKey}`).update(dateStamp).digest()
  const regionKey = createHmac('sha256', dateKey).update(input.region).digest()
  const serviceKey = createHmac('sha256', regionKey).update('s3').digest()
  const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest()
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`,
    canonicalHash: createHash('sha256').update(canonical).digest('hex'),
    amzDate,
    payloadHash: input.payloadHash,
  }
}

/**
 * @param {string} xml
 */
export function parseListBucket(xml) {
  /** @type {Array<{ key: string, lastModified: Date }>} */
  const objects = []
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1] ?? ''
    const key = block.match(/<Key>([^<]*)<\/Key>/)?.[1]
    const modified = block.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1]
    if (!key || !modified)
      continue
    objects.push({
      key: decodeXml(key),
      lastModified: new Date(modified),
    })
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const token = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1]
  return {
    objects,
    continuationToken: truncated && token ? decodeXml(token) : null,
  }
}

/**
 * @param {string} value
 */
function decodeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
}

/**
 * @param {ReturnType<typeof loadBackupS3Env>} settings
 * @param {string} method
 * @param {string} key
 * @param {Buffer | undefined} body
 * @param {URLSearchParams} query
 * @param {Date} now
 */
async function signedFetch(settings, method, key, body, query, now) {
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_SHA256
  const encodedKey = key.split('/').filter(Boolean).map(encodeRfc3986).join('/')
  const path = encodedKey.length === 0
    ? `/${encodeRfc3986(settings.bucket)}`
    : `/${encodeRfc3986(settings.bucket)}/${encodedKey}`
  const requestUrl = new URL(`${settings.endpoint.origin}${path}`)
  requestUrl.search = query.toString()
  const signed = signAwsRequest({
    method,
    url: requestUrl,
    payloadHash,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    region: settings.region,
    now,
  })
  const response = await fetch(requestUrl, {
    method,
    headers: {
      'authorization': signed.authorization,
      'x-amz-content-sha256': signed.payloadHash,
      'x-amz-date': signed.amzDate,
    },
    body,
  })
  if (!response.ok) {
    const text = await response.text()
    const code = text.match(/<Code>([^<]*)<\/Code>/)?.[1] ?? 'S3Error'
    throw new Error(`S3 ${method} failed (${response.status} ${code})`)
  }
  return response
}

/**
 * @param {ReturnType<typeof loadBackupS3Env>} settings
 * @param {string} key
 * @param {string} file
 */
export async function putBackupObject(settings, key, file) {
  const body = readFileSync(file)
  await signedFetch(settings, 'PUT', key, body, new URLSearchParams(), new Date())
}

/**
 * @param {ReturnType<typeof loadBackupS3Env>} settings
 * @param {string} key
 * @param {string} file
 */
export async function getBackupObject(settings, key, file) {
  const response = await signedFetch(settings, 'GET', key, undefined, new URLSearchParams(), new Date())
  const bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(file, bytes, { mode: 0o600 })
}

/**
 * @param {ReturnType<typeof loadBackupS3Env>} settings
 * @param {string} prefix
 */
export async function listBackupObjects(settings, prefix) {
  /** @type {Array<{ key: string, lastModified: Date }>} */
  const objects = []
  let token = ''
  do {
    const query = new URLSearchParams({
      'list-type': '2',
      'prefix': `${prefix}/`,
    })
    if (token)
      query.set('continuation-token', token)
    const response = await signedFetch(settings, 'GET', '', undefined, query, new Date())
    const page = parseListBucket(await response.text())
    objects.push(...page.objects)
    token = page.continuationToken ?? ''
  } while (token)
  return objects
}

/**
 * @param {ReturnType<typeof loadBackupS3Env>} settings
 */
export async function pruneDailyBackups(settings) {
  const objects = await listBackupObjects(settings, settings.prefix)
  const stale = keysToPrune(objects, new Date(), settings.prefix)
  for (const key of stale)
    await signedFetch(settings, 'DELETE', key, undefined, new URLSearchParams(), new Date())
  return stale
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
    const settings = loadBackupS3Env()
    if (command === 'key') {
      process.stdout.write(`${backupObjectKey(settings.prefix, new Date())}\n`)
    }
    else if (command === 'put') {
      const file = args[0]
      const key = args[1]
      if (!file || !key)
        throw new Error('usage: s3-object.mjs put <file> <key>')
      await putBackupObject(settings, key, file)
    }
    else if (command === 'get') {
      const key = args[0]
      const file = args[1]
      if (!key || !file)
        throw new Error('usage: s3-object.mjs get <key> <file>')
      await getBackupObject(settings, key, file)
    }
    else if (command === 'latest') {
      const objects = await listBackupObjects(settings, settings.prefix)
      process.stdout.write(`${latestDailyKey(objects, settings.prefix)}\n`)
    }
    else if (command === 'prune') {
      await pruneDailyBackups(settings)
    }
    else {
      throw new Error('usage: s3-object.mjs key|put|get|latest|prune')
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'backup object failed'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
