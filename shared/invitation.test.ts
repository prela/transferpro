import { expect, it } from 'vitest'
import { acceptErrorKey } from './invitation'
import { inviteLink } from './invite-link'

const invitationId = '6b1e0c3a-2222-4222-8222-222222222222'

it('puts the invitation id in the hash and not the query', () => {
  const link = new URL(inviteLink('http://localhost:3000', invitationId))
  expect(link.pathname).toBe('/accept-invite')
  expect(link.search).toBe('')
  expect(link.hash).toBe(`#${invitationId}`)
})

it('maps accept failures to one screen message each', () => {
  expect(acceptErrorKey(422)).toBe('acceptInvite.passwordRules')
  expect(acceptErrorKey(429)).toBe('acceptInvite.limited')
  expect(acceptErrorKey(409)).toBe('acceptInvite.signInTitle')
  expect(acceptErrorKey(400)).toBe('acceptInvite.failed')
  expect(acceptErrorKey(403)).toBe('acceptInvite.failed')
})
