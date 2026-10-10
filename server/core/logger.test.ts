import { afterEach, expect, it } from 'vitest'
import { endRequestLog, handleLoggedError, openRequestLog, resolveRequestId, runWithRequestId } from './index'
import { runWithTenantId } from './logger'
import { captureLogs } from './testing'

afterEach(() => {
  endRequestLog()
})

/**
 * Logger seam: callers pass a payload to `createLogger` and read the JSON
 * line that comes out. Redaction is judged on that line, not on a helper.
 */

it('redacts a passenger name, phone, email, and an auth token', () => {
  const logs = captureLogs()
  logs.logger.info({
    passenger: {
      name: 'Ana Horvat',
      phone: '+385911112222',
      email: 'ana@example.com',
    },
    token: 'session-token-value',
    user_id: '6b1e0c3a-1111-4111-8111-111111111111',
  })

  const [line] = logs.lines()
  expect(line?.passenger).toEqual({
    name: '[Redacted]',
    phone: '[Redacted]',
    email: '[Redacted]',
  })
  expect(line?.token).toBe('[Redacted]')
  expect(line?.user_id).toBe('6b1e0c3a-1111-4111-8111-111111111111')
  const text = JSON.stringify(line)
  expect(text).not.toContain('Ana Horvat')
  expect(text).not.toContain('ana@example.com')
  expect(text).not.toContain('session-token-value')
  expect(text).not.toContain('+385911112222')
})

it('redacts charter personal-data and secret fields at any key shape', () => {
  const logs = captureLogs()
  logs.logger.info({
    guest_name: 'Iva Kovač',
    phoneNumber: '+385911110000',
    flight_number: 'OU392',
    address: 'Ilica 1, Zagreb',
    price: '42.00 EUR',
    notes: 'allergic to nuts',
    tabla: 'GOSPOĐA HORVAT',
    cookie: 'better-auth.session=abc',
    connectionString: 'postgres://app:secret@localhost/transferpro',
    user_id: '6b1e0c3a-1111-4111-8111-111111111111',
  })

  const [line] = logs.lines()
  expect(line).toMatchObject({
    guest_name: '[Redacted]',
    phoneNumber: '[Redacted]',
    flight_number: '[Redacted]',
    address: '[Redacted]',
    price: '[Redacted]',
    notes: '[Redacted]',
    tabla: '[Redacted]',
    cookie: '[Redacted]',
    connectionString: '[Redacted]',
    user_id: '6b1e0c3a-1111-4111-8111-111111111111',
  })
  const text = JSON.stringify(line)
  expect(text).not.toContain('OU392')
  expect(text).not.toContain('postgres://app:secret')
  expect(text).not.toContain('allergic to nuts')
  expect(text).not.toContain('GOSPOĐA HORVAT')
})

it('redacts an invitation id and an invite link', () => {
  const logs = captureLogs()
  const invitationId = '6b1e0c3a-2222-4222-8222-222222222222'
  logs.logger.info({
    invitationId,
    inviteUrl: `http://localhost:3000/accept-invite#${invitationId}`,
    path: `http://localhost:3000/accept-invite#${invitationId}`,
    slash: `http://localhost:3000/accept-invite/${invitationId}`,
    query: `invitationId=${invitationId}`,
    invitation: { id: invitationId, status: 'pending' },
  }, `opened accept-invite#${invitationId} accept-invite/${invitationId} invitationId=${invitationId}`)

  const [line] = logs.lines()
  expect(line).toMatchObject({
    invitationId: '[Redacted]',
    inviteUrl: '[Redacted]',
    invitation: { id: '[Redacted]', status: 'pending' },
  })
  const text = JSON.stringify(line)
  expect(text).not.toContain(invitationId)
  expect(text).toContain('accept-invite#[Redacted]')
  expect(text).toContain('accept-invite/[Redacted]')
  expect(text).toContain('invitationId=[Redacted]')
  expect(text).toContain('pending')
})

it('redacts secret-like keys by substring and a postgres detail field', () => {
  const logs = captureLogs()
  const duplicate = new Error('duplicate key')
  Object.assign(duplicate, { detail: 'Key (email)=(ana@example.com) already exists' })
  logs.logger.info({
    BETTER_AUTH_SECRET: 'super-secret-value',
    AUTH_DATABASE_URL: 'postgres://auth:pw@localhost/transferpro',
    err: duplicate,
    user_id: '6b1e0c3a-1111-4111-8111-111111111111',
  })

  const [line] = logs.lines()
  expect(line).toMatchObject({
    BETTER_AUTH_SECRET: '[Redacted]',
    AUTH_DATABASE_URL: '[Redacted]',
    user_id: '6b1e0c3a-1111-4111-8111-111111111111',
  })
  expect(line?.err).toMatchObject({ type: 'Error', detail: '[Redacted]' })
  const text = JSON.stringify(line)
  expect(text).not.toContain('super-secret-value')
  expect(text).not.toContain('postgres://auth:pw')
  expect(text).not.toContain('ana@example.com')
})

const requestId = '6b1e0c3a-1111-4111-8111-111111111111'

it('reuses a safe incoming request id', () => {
  expect(resolveRequestId(requestId)).toBe(requestId)
  expect(resolveRequestId('req_123.abc-1')).toBe('req_123.abc-1')
})

it('generates a request id when the header is missing or unsafe', () => {
  const generated = resolveRequestId(undefined)
  expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(resolveRequestId('')).toMatch(/^[0-9a-f]{8}-/)
  const fromNewline = resolveRequestId('bad\nid')
  expect(fromNewline).not.toBe('bad\nid')
  expect(fromNewline).not.toContain('\n')
  expect(resolveRequestId('ana@example.com')).not.toBe('ana@example.com')
})

it('puts request_id on lines inside the request and omits it outside', () => {
  const logs = captureLogs()
  logs.logger.info({ event: 'before' })
  runWithRequestId(requestId, () => {
    logs.logger.info({ event: 'during' })
  })
  logs.logger.info({ event: 'after' })

  const [before, during, after] = logs.lines()
  expect(before?.request_id).toBeUndefined()
  expect(during?.request_id).toBe(requestId)
  expect(during?.event).toBe('during')
  expect(after?.request_id).toBeUndefined()
})

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

it('adds tenant_id only inside the tenant call', async () => {
  const logs = captureLogs()
  logs.logger.info({ event: 'boot' })
  await runWithRequestId(requestId, async () => {
    logs.logger.info({ event: 'request' })
    await runWithTenantId(tenantId, async () => {
      await Promise.resolve()
      logs.logger.info({ event: 'tenant' })
    })
    logs.logger.info({ event: 'after-tenant' })
  })

  const [boot, request, tenant, afterTenant] = logs.lines()
  expect(boot?.tenant_id).toBeUndefined()
  expect(boot?.request_id).toBeUndefined()
  expect(request).toMatchObject({ event: 'request', request_id: requestId })
  expect(request?.tenant_id).toBeUndefined()
  expect(tenant).toMatchObject({ event: 'tenant', request_id: requestId, tenant_id: tenantId })
  expect(afterTenant).toMatchObject({ event: 'after-tenant', request_id: requestId })
  expect(afterTenant?.tenant_id).toBeUndefined()
})

it('logs a thrown error once and keeps its stack and message out of the response body', () => {
  const logs = captureLogs()
  const error = new TypeError('passenger Ana Horvat at secret/handler.ts:12')
  error.stack = 'TypeError: passenger Ana Horvat at secret/handler.ts:12\n    at secret/handler.ts:12:3'
  const body = handleLoggedError(logs.logger, error, requestId)

  expect(body).toEqual({
    statusCode: 500,
    message: 'Internal Server Error',
    request_id: requestId,
  })
  const text = JSON.stringify(body)
  expect(text).not.toContain('Ana Horvat')
  expect(text).not.toContain('secret/handler.ts')
  expect(text).not.toContain('stack')
  expect(logs.lines()).toHaveLength(1)
  expect(logs.lines()[0]?.err).toMatchObject({ type: 'TypeError' })
  expect((logs.lines()[0]?.err as { stack?: string }).stack).toContain('secret/handler.ts:12')
  expect(error.stack).toContain('secret/handler.ts:12')
})

it('logs a refused request at warn and a failure at error, with the same body shape', () => {
  const logs = captureLogs()
  const refused = Object.assign(new Error('Member role is not a Tenant role.'), { statusCode: 409 })
  expect(handleLoggedError(logs.logger, refused, requestId)).toEqual({
    statusCode: 409,
    message: 'Request failed',
    request_id: requestId,
  })
  handleLoggedError(logs.logger, new Error('connection reset'), requestId)

  // Pino's numeric levels: 40 is warn, 50 is error.
  expect(logs.lines().map(line => line.level)).toEqual([40, 50])
})

it('forwards a safe client error code on a 409 so the UI can tell conflicts apart', () => {
  const logs = captureLogs()
  const refused = Object.assign(new Error('Conflict'), {
    statusCode: 409,
    data: { code: 'vehicle_archived_plate' },
  })
  expect(handleLoggedError(logs.logger, refused, requestId)).toEqual({
    statusCode: 409,
    message: 'Request failed',
    request_id: requestId,
    code: 'vehicle_archived_plate',
  })
  const dropped = Object.assign(new Error('Conflict'), {
    statusCode: 409,
    data: { code: 'Vehicle Archived!' },
  })
  expect(handleLoggedError(logs.logger, dropped, requestId)).toEqual({
    statusCode: 409,
    message: 'Request failed',
    request_id: requestId,
  })
})

it('returns the request id for the response header and keeps it on later async work', async () => {
  const logs = captureLogs()
  expect(openRequestLog(requestId)).toBe(requestId)
  await Promise.resolve()
  logs.logger.info({ event: 'handler' })

  const [line] = logs.lines()
  expect(line?.request_id).toBe(requestId)
  expect(line?.tenant_id).toBeUndefined()

  endRequestLog()
  logs.logger.info({ event: 'next' })
  expect(logs.lines()[1]?.request_id).toBeUndefined()
})

it('ignores a tenant_id passed on the payload outside a tenant call', () => {
  const logs = captureLogs()
  logs.logger.info({ event: 'boot', tenant_id: tenantId, request_id: requestId })
  const [line] = logs.lines()
  expect(line?.event).toBe('boot')
  expect(line?.tenant_id).toBeUndefined()
  expect(line?.request_id).toBeUndefined()
})

it('drops a debug line when the level is info', () => {
  const logs = captureLogs()
  logs.logger.debug({ event: 'hidden' })
  logs.logger.info({ event: 'shown' })
  expect(logs.lines().map(line => line.event)).toEqual(['shown'])
})
