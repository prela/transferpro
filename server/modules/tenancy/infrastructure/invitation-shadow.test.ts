import { expect, it } from 'vitest'
import { invitationShadowClear } from './invitation'

it('expires the path-scoped session cookie and marks a __Secure- name Secure', () => {
  expect(invitationShadowClear('better-auth.session_token')).toBe(
    'better-auth.session_token=; Path=/api/invitations; Max-Age=0',
  )
  expect(invitationShadowClear('__Secure-better-auth.session_token')).toBe(
    '__Secure-better-auth.session_token=; Path=/api/invitations; Max-Age=0; Secure',
  )
})
