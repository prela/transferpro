import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM for the current tool's token (ADR-0051).
 * The nonce is 96 bits and fresh on every write. The Tenant id is
 * associated data, so a ciphertext copied onto another Tenant does not
 * decrypt. The auth tag rides on the ciphertext. The plaintext is never
 * put on an error.
 */

const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16

/** A wrong key, a wrong Tenant, or a damaged blob. The message has no token. */
export class InvoicingTokenDecryptError extends Error {
  constructor() {
    super('Invoicing token could not be decrypted.')
    this.name = 'InvoicingTokenDecryptError'
  }
}

/** The key is missing when a token is being written. The message has no key. */
export class InvoicingKeyMissingError extends Error {
  readonly statusCode = 500

  constructor() {
    super('Invoicing secret key is missing.')
    this.name = 'InvoicingKeyMissingError'
  }
}

export interface InvoicingCiphertext {
  readonly ciphertext: Buffer
  readonly nonce: Buffer
}

/**
 * Encrypt one token. `key` is 32 bytes. `tenantId` is bound as associated
 * data and is not stored inside the ciphertext.
 */
export function encryptInvoicingToken(token: string, key: Uint8Array, tenantId: string): InvoicingCiphertext {
  if (key.byteLength !== 32)
    throw new Error('Invoicing key must be 32 bytes.')
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  cipher.setAAD(Buffer.from(tenantId, 'utf8'))
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()])
  return { ciphertext, nonce }
}

/**
 * Decrypt one token. A wrong key and another Tenant's id both fail closed.
 * The thrown error does not carry the plaintext.
 */
export function decryptInvoicingToken(
  ciphertext: Buffer,
  nonce: Buffer,
  key: Uint8Array,
  tenantId: string,
): string {
  if (key.byteLength !== 32 || nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength <= TAG_BYTES)
    throw new InvoicingTokenDecryptError()
  const tag = ciphertext.subarray(ciphertext.byteLength - TAG_BYTES)
  const body = ciphertext.subarray(0, ciphertext.byteLength - TAG_BYTES)
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce)
    decipher.setAAD(Buffer.from(tenantId, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  }
  catch {
    throw new InvoicingTokenDecryptError()
  }
}
