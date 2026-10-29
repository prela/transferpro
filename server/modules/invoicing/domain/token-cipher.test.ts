import { Buffer } from 'node:buffer'
import { expect, it } from 'vitest'
import { decryptInvoicingToken, encryptInvoicingToken, InvoicingTokenDecryptError } from './token-cipher'

const token = 'current-tool-token-4242'
const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function key(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte)
}

it('round-trips a token and uses a fresh nonce on every write', () => {
  const first = encryptInvoicingToken(token, key(1), tenantA)
  const second = encryptInvoicingToken(token, key(1), tenantA)
  expect(first.nonce).toHaveLength(12)
  expect(second.nonce).toHaveLength(12)
  expect(Buffer.compare(first.nonce, second.nonce)).not.toBe(0)
  expect(Buffer.compare(first.ciphertext, second.ciphertext)).not.toBe(0)
  expect(decryptInvoicingToken(first.ciphertext, first.nonce, key(1), tenantA)).toBe(token)
  expect(first.ciphertext.toString('utf8')).not.toContain(token)
})

it('fails to decrypt with a wrong key', () => {
  const sealed = encryptInvoicingToken(token, key(1), tenantA)
  expect(() => decryptInvoicingToken(sealed.ciphertext, sealed.nonce, key(2), tenantA)).toThrow(InvoicingTokenDecryptError)
})

it('fails to decrypt with another Tenant id', () => {
  const sealed = encryptInvoicingToken(token, key(1), tenantA)
  expect(() => decryptInvoicingToken(sealed.ciphertext, sealed.nonce, key(1), tenantB)).toThrow(InvoicingTokenDecryptError)
})
