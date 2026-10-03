import { expect, it } from 'vitest'
import { signInErrorKey } from './sign-in-error'

it('uses one failure message whether or not the email exists', () => {
  expect(signInErrorKey(400)).toBe('signIn.failed')
  expect(signInErrorKey(401)).toBe('signIn.failed')
  expect(signInErrorKey(403)).toBe('signIn.failed')
  expect(signInErrorKey(500)).toBe('signIn.failed')
  expect(signInErrorKey(429)).toBe('signIn.limited')
})
