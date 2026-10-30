import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { assertJobPayload, JobPayloadError, jobPayloads } from './job-payloads'

/**
 * Job names the foundation RLS cases keep, so they do not take a product job
 * off a shared database. They follow the same payload rules.
 */
const foundationQueues = [
  'foundation_publish',
  'foundation_request',
  'foundation_rollback',
  'foundation_session',
  'foundation_worker',
] as const

const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantId = '33333333-3333-4333-8333-333333333333'
const askedAt = '2026-10-21T00:15:00.000Z'
const refusedEmail = 'refused-386@example.com'

const serverDir = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.'))
      continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory())
      found.push(...sourceFiles(path))
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
      found.push(path)
  }
  return found
}

/** The string a module exports for a queue, a tick, a delete, or an ask. */
function jobNamesInSource(): string[] {
  const declaration = /export const ([A-Z0-9_]+) = '([^']+)'/g
  const names: string[] = []
  for (const path of sourceFiles(serverDir)) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(declaration)) {
      const constant = match[1] ?? ''
      const value = match[2]
      const isJob = constant === 'MAIL_OUTBOX_QUEUE'
        || constant === 'INVOICE_CREATE_QUEUE'
        || constant === 'INVOICE_STORNO_QUEUE'
        || constant.endsWith('_TICK')
        || constant.endsWith('_DELETE')
        || constant.endsWith('_ASK')
        || constant.endsWith('_CHECK')
      if (isJob && value !== undefined)
        names.push(value)
    }
  }
  return names
}

function sample(name: string): unknown {
  if (name === 'mail-outbox')
    return { entryId }
  if (name === 'invoice-create' || name === 'invoice-storno')
    return { invoiceId: entryId }
  if (name === 'foundation_rollback')
    return { token: 'kept' }
  if (name === 'foundation_session')
    return { tenantId }
  if (name.endsWith('-tenant') || name.endsWith('-ask') || name.endsWith('-check'))
    return { askedAt }
  return {}
}

it('registers every job name used on develop, and only those plus the foundation queues', () => {
  const used = jobNamesInSource()
  expect(used.length).toBeGreaterThan(0)
  expect(Object.keys(jobPayloads).sort()).toEqual([...used, ...foundationQueues].sort())
})

it('accepts a registered payload of ids, an instant, or an enum, and refuses anything else', () => {
  for (const name of Object.keys(jobPayloads))
    expect(() => assertJobPayload(name, sample(name))).not.toThrow()

  expect(() => assertJobPayload('not-a-registered-job', {})).toThrow(JobPayloadError)
  expect(() => assertJobPayload('toString', {})).toThrow(new JobPayloadError('unknown job'))
  expect(() => assertJobPayload(refusedEmail, {})).toThrow(JobPayloadError)

  let leaked: unknown
  try {
    assertJobPayload('mail-outbox', { entryId, email: refusedEmail })
  }
  catch (error) {
    leaked = error
  }
  expect(leaked).toBeInstanceOf(JobPayloadError)
  expect(String(leaked)).not.toContain(refusedEmail)
  expect(String(leaked)).not.toContain('email')
  expect(() => assertJobPayload('mail-outbox', { entryId: 'not-a-uuid' })).toThrow(JobPayloadError)
  expect(() => assertJobPayload('mail-outbox-retention', { note: 'free text' })).toThrow(JobPayloadError)

  try {
    assertJobPayload(refusedEmail, { email: refusedEmail })
  }
  catch (error) {
    leaked = error
  }
  expect(String(leaked)).not.toContain(refusedEmail)
})
