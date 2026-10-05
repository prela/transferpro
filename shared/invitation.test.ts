import { expect, it } from 'vitest'
import { acceptErrorKey, invitationPreviewSchema, passwordLengthRule } from './invitation'
import { inviteLink } from './invite-link'

const invitationId = '6b1e0c3a-2222-4222-8222-222222222222'

it('puts the invitation id in the hash and not the query', () => {
  const link = new URL(inviteLink('http://localhost:3000', invitationId))
  expect(link.pathname).toBe('/accept-invite')
  expect(link.search).toBe('')
  expect(link.hash).toBe(`#${invitationId}`)
})

it('names a password that misses a length bound from the caller', () => {
  const limits = { minPasswordLength: 8, maxPasswordLength: 12 }
  expect(passwordLengthRule('short', limits)).toBe('too-short')
  expect(passwordLengthRule('a'.repeat(13), limits)).toBe('too-long')
  expect(passwordLengthRule('a'.repeat(8), limits)).toBeNull()
  expect(passwordLengthRule('a'.repeat(12), limits)).toBeNull()
})

it('accepts a preview that names the signed-in account', () => {
  expect(invitationPreviewSchema.parse({
    state: 'wrong-account',
    account: 'ada@example.test',
  })).toEqual({ state: 'wrong-account', account: 'ada@example.test' })
  expect(invitationPreviewSchema.parse({
    state: 'set-password',
    minPasswordLength: 8,
    maxPasswordLength: 128,
  })).toEqual({ state: 'set-password', minPasswordLength: 8, maxPasswordLength: 128 })
})

it('maps accept failures to one screen message each', () => {
  expect(acceptErrorKey(422)).toBe('acceptInvite.passwordRules')
  expect(acceptErrorKey(429)).toBe('acceptInvite.limited')
  expect(acceptErrorKey(409)).toBe('acceptInvite.signInTitle')
  expect(acceptErrorKey(400)).toBe('acceptInvite.failed')
  expect(acceptErrorKey(403)).toBe('acceptInvite.failed')
})
