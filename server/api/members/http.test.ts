import { describe, expect, it } from 'vitest'
import { memberErrorMessage } from '../../../shared'
import { handleLoggedError } from '../../core/index'
import { captureLogs } from '../../core/testing'
import { MemberAccessError, TenantAccessError } from '../../modules/tenancy'
import { memberHttpError, parseMemberUserId } from './http'

/** Both helpers throw an h3 error; the test reads what was thrown. */
function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('memberHttpError', () => {
  it('keeps the self-modification 409 phrase', () => {
    const error = thrown(() => memberHttpError(new MemberAccessError(409, 'Cannot change your own role.')))
    expect(error).toMatchObject({ statusCode: 409, statusMessage: 'Cannot change your own role.' })
  })

  it('keeps the last-admin 409 phrase', () => {
    const error = thrown(() => memberHttpError(new MemberAccessError(409)))
    expect(error).toMatchObject({ statusCode: 409, statusMessage: 'Cannot remove or demote the last admin.' })
  })

  it('keeps the fixed 409 phrase for a stored role the audit log cannot record, and the error handler warns', () => {
    const error = thrown(() => memberHttpError(new MemberAccessError(409, memberErrorMessage('member.roleNotTenant'))))
    expect(error).toMatchObject({ statusCode: 409, statusMessage: 'Member role is not a Tenant role.' })

    const logs = captureLogs()
    expect(handleLoggedError(logs.logger, error, 'req-role-not-tenant')).toEqual({
      statusCode: 409,
      message: 'Request failed',
      request_id: 'req-role-not-tenant',
    })
    expect(logs.lines().map(line => line.level)).toEqual([40])
  })

  it('answers a member 400 with "Bad request", not the thrown text', () => {
    const error = thrown(() => memberHttpError(new MemberAccessError(400, 'role: Invalid option')))
    expect(error).toMatchObject({ statusCode: 400, statusMessage: 'Bad request' })
  })

  it('maps a tenant 403 to Forbidden', () => {
    const error = thrown(() => memberHttpError(new TenantAccessError(403)))
    expect(error).toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
  })

  it('maps an unknown error to 500 and does not carry its message', () => {
    const original = new Error('password authentication failed for user "transferpro_auth"')
    const error = thrown(() => memberHttpError(original))
    expect(error).toMatchObject({ statusCode: 500, statusMessage: 'Internal server error' })
    expect((error as Error).cause).not.toBe(original)
    expect(JSON.stringify(error)).not.toContain('transferpro_auth')
    expect((error as Error).message).not.toContain('transferpro_auth')
  })

  it('answers "Bad request" when the caller chose 400 for an unknown error', () => {
    const error = thrown(() => memberHttpError(new Error('user id was "x"'), 400))
    expect(error).toMatchObject({ statusCode: 400, statusMessage: 'Bad request' })
    expect((error as Error).message).not.toContain('"x"')
  })
})

describe('parseMemberUserId', () => {
  it('returns a uuid unchanged', () => {
    expect(parseMemberUserId('3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c')).toBe('3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c')
  })

  it.each(['x', '', null, undefined])('rejects %j with 400 Bad request', (raw) => {
    expect(thrown(() => parseMemberUserId(raw))).toMatchObject({ statusCode: 400, statusMessage: 'Bad request' })
  })
})
