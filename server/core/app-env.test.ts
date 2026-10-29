import { Buffer } from 'node:buffer'
import { expect, it } from 'vitest'
import { parseAppEnv } from './index'

/**
 * Env seam: `parseAppEnv` is what boot reads. The log level is part of that
 * result, not a separate `process.env` lookup at log time.
 */
const base = {
  DATABASE_URL: 'postgres://app@127.0.0.1:5432/transferpro',
  AUTH_DATABASE_URL: 'postgres://auth@127.0.0.1:5432/transferpro',
  QUEUE_DATABASE_URL: 'postgres://queue@127.0.0.1:5432/transferpro',
  PLATFORM_DATABASE_URL: 'postgres://platform@127.0.0.1:5432/transferpro',
  BETTER_AUTH_SECRET: 'transferpro-test-secret-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  RESEND_API_KEY: 'test-resend-key',
}

it('defaults the log level to info in production and debug locally', () => {
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'resend' }).LOG_LEVEL).toBe('info')
  expect(parseAppEnv({ ...base, NODE_ENV: 'development' }).LOG_LEVEL).toBe('debug')
  expect(parseAppEnv({ ...base, LOG_LEVEL: '' }).LOG_LEVEL).toBe('debug')
})

it('uses an explicit log level from the environment', () => {
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'resend', LOG_LEVEL: 'warn' }).LOG_LEVEL).toBe('warn')
})

it('rejects an unknown log level', () => {
  expect(() => parseAppEnv({ ...base, LOG_LEVEL: 'verbose' })).toThrow()
})

it('allows a missing RESEND_API_KEY outside production', () => {
  const { RESEND_API_KEY: _removed, ...withoutKey } = base
  expect(parseAppEnv({ ...withoutKey, NODE_ENV: 'test' }).RESEND_API_KEY).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'test' }).RESEND_API_KEY).toBe('test-resend-key')
  expect(() => parseAppEnv({ ...withoutKey, NODE_ENV: 'production', MAILER: 'resend' })).toThrow()
  expect(parseAppEnv(withoutKey).RESEND_API_KEY).toBeUndefined()
})

it('requires MAILER=resend and the Resend key in production', () => {
  const { RESEND_API_KEY: _removed, ...withoutKey } = base
  expect(() => parseAppEnv({ ...base, NODE_ENV: 'production' })).toThrow()
  expect(() => parseAppEnv({ ...withoutKey, NODE_ENV: 'production', MAILER: 'resend' })).toThrow()
  expect(() => parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'console' })).toThrow()
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'resend' })).toMatchObject({
    MAILER: 'resend',
    RESEND_API_KEY: 'test-resend-key',
  })
})

/**
 * Preview runs the production image and must not spend the shared Resend
 * quota. The opt-in is exact: `1`, together with `MAILER=console`.
 * Anything else keeps the production rule (ADR-0013, ADR-0037).
 */
it('allows MAILER=console in production only when ALLOW_CONSOLE_MAILER is 1', () => {
  const { RESEND_API_KEY: _removed, ...withoutKey } = base
  expect(parseAppEnv({
    ...withoutKey,
    NODE_ENV: 'production',
    MAILER: 'console',
    ALLOW_CONSOLE_MAILER: '1',
  })).toMatchObject({
    MAILER: 'console',
    RESEND_API_KEY: undefined,
  })
  expect(parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'resend',
    ALLOW_CONSOLE_MAILER: '1',
  })).toMatchObject({
    MAILER: 'resend',
    RESEND_API_KEY: 'test-resend-key',
  })
  expect(() => parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'console',
    ALLOW_CONSOLE_MAILER: '0',
  })).toThrow()
  expect(() => parseAppEnv({
    ...withoutKey,
    NODE_ENV: 'production',
    ALLOW_CONSOLE_MAILER: '1',
  })).toThrow()
  expect(() => parseAppEnv({
    ...withoutKey,
    NODE_ENV: 'production',
    MAILER: 'resend',
    ALLOW_CONSOLE_MAILER: '1',
  })).toThrow()
})

it('accepts an optional SENTRY_DSN and SENTRY_RELEASE', () => {
  expect(parseAppEnv(base).SENTRY_DSN).toBeUndefined()
  expect(parseAppEnv(base).SENTRY_RELEASE).toBeUndefined()
  expect(parseAppEnv({
    ...base,
    SENTRY_DSN: 'https://o0.ingest.sentry.io/0',
    SENTRY_RELEASE: 'abc123def456',
  })).toMatchObject({
    SENTRY_DSN: 'https://o0.ingest.sentry.io/0',
    SENTRY_RELEASE: 'abc123def456',
  })
  expect(() => parseAppEnv({ ...base, SENTRY_DSN: 'not-a-url' })).toThrow()
})

it('requires the platform role url', () => {
  const { PLATFORM_DATABASE_URL: _removed, ...withoutPlatform } = base
  expect(() => parseAppEnv(withoutPlatform)).toThrow()
})

it('leaves MAILER unset in development and test', () => {
  expect(parseAppEnv(base).MAILER).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'test' }).MAILER).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'development', MAILER: 'console' }).MAILER).toBe('console')
  expect(parseAppEnv({ ...base, NODE_ENV: 'development', MAILER: 'resend' }).MAILER).toBe('resend')
})

/**
 * Preview names the only addresses that may reach Resend. Unset and blank
 * leave the selection alone. A blank entry or a bad email fails boot, and
 * the message does not repeat the value (ADR-0042).
 */
it('parses MAIL_ALLOWLIST as trimmed, case-insensitive emails', () => {
  expect(parseAppEnv(base).MAIL_ALLOWLIST).toBeUndefined()
  expect(parseAppEnv({ ...base, MAIL_ALLOWLIST: '' }).MAIL_ALLOWLIST).toBeUndefined()
  expect(parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'resend',
    MAIL_ALLOWLIST: ' Owner@Example.COM , second@example.com ',
  }).MAIL_ALLOWLIST).toEqual(['owner@example.com', 'second@example.com'])
  const listed = 'owner@example.com'
  const invalid = 'not-an-email'
  expect(() => parseAppEnv({ ...base, MAIL_ALLOWLIST: `${listed},` })).toThrow('MAIL_ALLOWLIST has a blank or invalid email.')
  expect(() => parseAppEnv({ ...base, MAIL_ALLOWLIST: invalid })).toThrow('MAIL_ALLOWLIST has a blank or invalid email.')
  expect(() => parseAppEnv({ ...base, MAIL_ALLOWLIST: '   ' })).toThrow('MAIL_ALLOWLIST has a blank or invalid email.')
  expect(() => parseAppEnv({ ...base, MAIL_ALLOWLIST: `${listed}, ${invalid}` })).toThrow('MAIL_ALLOWLIST has a blank or invalid email.')
  try {
    parseAppEnv({ ...base, MAIL_ALLOWLIST: `${listed}, ${invalid}` })
  }
  catch (error) {
    const text = String(error)
    expect(text).not.toContain(listed)
    expect(text).not.toContain(invalid)
  }
})

/**
 * Preview and production both run with NODE_ENV=production. DEPLOY_ENV is
 * how boot tells them apart. Preview cannot start without MAIL_ALLOWLIST.
 * Unset, blank, and production leave the list optional, including the
 * ADR-0037 console opt-in. A typo fails boot and the message omits the value.
 */
it('boots preview when MAIL_ALLOWLIST is set', () => {
  expect(parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'resend',
    DEPLOY_ENV: 'preview',
    MAIL_ALLOWLIST: 'owner@example.com',
  })).toMatchObject({
    DEPLOY_ENV: 'preview',
    MAILER: 'resend',
    MAIL_ALLOWLIST: ['owner@example.com'],
  })
  // Preview still uses the production image, so the resend rule stays.
  expect(() => parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    DEPLOY_ENV: 'preview',
    MAIL_ALLOWLIST: 'owner@example.com',
  })).toThrow('Invalid input: expected \\"resend\\"')
})

it('fails preview boot when MAIL_ALLOWLIST is unset', () => {
  expect(() => parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'resend',
    DEPLOY_ENV: 'preview',
  })).toThrow('MAIL_ALLOWLIST is required when DEPLOY_ENV is preview.')
})

it('fails preview boot when MAIL_ALLOWLIST is blank', () => {
  expect(() => parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'resend',
    DEPLOY_ENV: 'preview',
    MAIL_ALLOWLIST: '',
  })).toThrow('MAIL_ALLOWLIST is required when DEPLOY_ENV is preview.')
})

it('leaves MAIL_ALLOWLIST optional when DEPLOY_ENV is unset, blank, or production', () => {
  expect(parseAppEnv(base).DEPLOY_ENV).toBeUndefined()
  expect(parseAppEnv(base).MAIL_ALLOWLIST).toBeUndefined()
  expect(parseAppEnv({ ...base, DEPLOY_ENV: '' }).DEPLOY_ENV).toBeUndefined()
  expect(parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'resend',
  }).MAIL_ALLOWLIST).toBeUndefined()
  expect(parseAppEnv({
    ...base,
    NODE_ENV: 'production',
    MAILER: 'resend',
    DEPLOY_ENV: 'production',
  })).toMatchObject({
    DEPLOY_ENV: 'production',
    MAIL_ALLOWLIST: undefined,
  })

  const { RESEND_API_KEY: _removed, ...withoutKey } = base
  expect(parseAppEnv({
    ...withoutKey,
    NODE_ENV: 'production',
    MAILER: 'console',
    ALLOW_CONSOLE_MAILER: '1',
    DEPLOY_ENV: 'production',
  })).toMatchObject({
    DEPLOY_ENV: 'production',
    MAILER: 'console',
    MAIL_ALLOWLIST: undefined,
  })
})

it('rejects an unknown DEPLOY_ENV without echoing the value', () => {
  const unexpected = 'staging-not-a-deploy-env'
  expect(() => parseAppEnv({ ...base, DEPLOY_ENV: unexpected })).toThrow(
    'DEPLOY_ENV must be preview, production, or unset.',
  )
  try {
    parseAppEnv({ ...base, DEPLOY_ENV: unexpected })
  }
  catch (error) {
    expect(String(error)).not.toContain(unexpected)
  }
})

it('defaults MAPS to none and refuses google without a key', () => {
  expect(parseAppEnv(base).MAPS).toBe('none')
  expect(parseAppEnv(base).MAPS_API_KEY).toBeUndefined()
  expect(parseAppEnv({ ...base, NODE_ENV: 'production', MAILER: 'resend' }).MAPS).toBe('none')
  expect(parseAppEnv({ ...base, MAPS: 'none', MAPS_API_KEY: '' }).MAPS_API_KEY).toBeUndefined()
  expect(() => parseAppEnv({ ...base, MAPS: 'google' })).toThrow()
  expect(() => parseAppEnv({ ...base, MAPS: 'google', MAPS_API_KEY: '' })).toThrow()
  expect(() => parseAppEnv({ ...base, MAPS: 'osm' })).toThrow()
  expect(parseAppEnv({ ...base, MAPS: 'google', MAPS_API_KEY: 'maps-live-key' })).toMatchObject({
    MAPS: 'google',
    MAPS_API_KEY: 'maps-live-key',
  })
  try {
    parseAppEnv({ ...base, MAPS: 'google' })
  }
  catch (error) {
    expect(String(error)).not.toContain('maps-live-key')
  }
})

it('keeps MAPS_EMBED_KEY optional, treats blank as missing, and never echoes the key', () => {
  const embedKey = 'embed-secret-value'
  expect(parseAppEnv(base).MAPS_EMBED_KEY).toBeUndefined()
  expect(parseAppEnv({ ...base, MAPS: 'none', MAPS_EMBED_KEY: '' }).MAPS_EMBED_KEY).toBeUndefined()
  expect(parseAppEnv({ ...base, MAPS: 'none', MAPS_EMBED_KEY: embedKey })).toMatchObject({
    MAPS: 'none',
    MAPS_EMBED_KEY: embedKey,
  })
  expect(parseAppEnv({
    ...base,
    MAPS: 'google',
    MAPS_API_KEY: 'maps-live-key',
    MAPS_EMBED_KEY: '',
  }).MAPS_EMBED_KEY).toBeUndefined()
  expect(parseAppEnv({
    ...base,
    MAPS: 'google',
    MAPS_API_KEY: 'maps-live-key',
    MAPS_EMBED_KEY: embedKey,
  })).toMatchObject({
    MAPS: 'google',
    MAPS_API_KEY: 'maps-live-key',
    MAPS_EMBED_KEY: embedKey,
  })
  try {
    parseAppEnv({ ...base, MAPS: 'google', MAPS_EMBED_KEY: embedKey })
  }
  catch (error) {
    expect(String(error)).not.toContain(embedKey)
  }
  try {
    parseAppEnv({ ...base, MAPS: 'osm', MAPS_EMBED_KEY: embedKey })
  }
  catch (error) {
    expect(String(error)).not.toContain(embedKey)
  }
})

const invoicingKey = Buffer.alloc(32, 4).toString('base64')

it('defaults INVOICING to none and does not require the key', () => {
  expect(parseAppEnv(base).INVOICING).toBe('none')
  expect(parseAppEnv(base).INVOICING_SECRET_KEY).toBeUndefined()
  expect(parseAppEnv({ ...base, INVOICING: '' }).INVOICING).toBe('none')
  expect(parseAppEnv({ ...base, INVOICING: 'none', INVOICING_SECRET_KEY: invoicingKey }).INVOICING_SECRET_KEY).toHaveLength(32)
})

it('refuses an invoicing adapter without the key and does not echo a bad value', () => {
  expect(() => parseAppEnv({ ...base, INVOICING: 'current' })).toThrow(/INVOICING_SECRET_KEY is required/)
  const bad = 'not-a-real-key'
  expect(() => parseAppEnv({ ...base, INVOICING: 'current', INVOICING_SECRET_KEY: bad })).toThrow(/INVOICING_SECRET_KEY is invalid/)
  try {
    parseAppEnv({ ...base, INVOICING: 'current', INVOICING_SECRET_KEY: bad })
  }
  catch (error) {
    expect(String(error)).not.toContain(bad)
  }
  try {
    parseAppEnv({ ...base, INVOICING: 'nope' })
  }
  catch (error) {
    expect(String(error)).not.toContain('nope')
    expect(String(error)).toMatch(/INVOICING must be none, current, or unset/)
  }
  expect(parseAppEnv({ ...base, INVOICING: 'current', INVOICING_SECRET_KEY: invoicingKey })).toMatchObject({
    INVOICING: 'current',
  })
})
