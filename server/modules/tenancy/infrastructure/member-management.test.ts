import { describe, expect, it } from 'vitest'
import { MemberAccessError, parseChangeMemberRole } from './member-management'

describe('parseChangeMemberRole', () => {
  it('accepts valid admin role', () => {
    const result = parseChangeMemberRole({ role: 'admin' })
    expect(result).toEqual({ role: 'admin' })
  })

  it('accepts valid dispatcher role', () => {
    const result = parseChangeMemberRole({ role: 'dispatcher' })
    expect(result).toEqual({ role: 'dispatcher' })
  })

  it('accepts valid driver role', () => {
    const result = parseChangeMemberRole({ role: 'driver' })
    expect(result).toEqual({ role: 'driver' })
  })

  it('rejects owner role', () => {
    expect(() => parseChangeMemberRole({ role: 'owner' })).toThrow()
  })

  it('rejects member role', () => {
    expect(() => parseChangeMemberRole({ role: 'member' })).toThrow()
  })

  it('rejects empty body', () => {
    expect(() => parseChangeMemberRole({})).toThrow()
  })

  it('rejects null', () => {
    expect(() => parseChangeMemberRole(null)).toThrow()
  })

  it('rejects undefined', () => {
    expect(() => parseChangeMemberRole(undefined)).toThrow()
  })
})

describe('memberAccessError', () => {
  it('creates error with status code 401', () => {
    const error = new MemberAccessError(401)
    expect(error.statusCode).toBe(401)
    expect(error.message).toBe('Unauthorized')
  })

  it('creates error with status code 403', () => {
    const error = new MemberAccessError(403)
    expect(error.statusCode).toBe(403)
    expect(error.message).toBe('Forbidden')
  })

  it('creates error with status code 404', () => {
    const error = new MemberAccessError(404)
    expect(error.statusCode).toBe(404)
    expect(error.message).toBe('Member not found.')
  })

  it('creates error with status code 409', () => {
    const error = new MemberAccessError(409)
    expect(error.statusCode).toBe(409)
    expect(error.message).toBe('Cannot remove or demote the last admin.')
  })

  it('creates error with custom message', () => {
    const error = new MemberAccessError(400, 'Custom message')
    expect(error.statusCode).toBe(400)
    expect(error.message).toBe('Custom message')
  })
})
