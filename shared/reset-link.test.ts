import { expect, it } from 'vitest'
import { resetPasswordLink, resetTokenFromLink } from './reset-link'

const token = 'AbCdEfGhIjKlMnOpQrStUvWx'

it('puts the reset token in the hash and not the query', () => {
  const link = new URL(resetPasswordLink('http://localhost:3000', token))
  expect(link.pathname).toBe('/reset-password')
  expect(link.search).toBe('')
  expect(link.hash).toBe(`#${token}`)
  expect(resetTokenFromLink(link.href)).toBe(token)
})
