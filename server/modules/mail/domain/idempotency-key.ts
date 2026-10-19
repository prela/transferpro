import { createHash } from 'node:crypto'

/**
 * The composed mail, a work order or an invitation. The address is passed apart:
 * Resend binds the key to the posted payload, and the address is that payload's recipient.
 */
export interface IdempotentMail {
  readonly subject: string
  readonly text: string
  readonly html: string
}

/**
 * Entry id plus a hash of the composed message and the recipient (ADR-0045).
 * The address is hashed, not written into the key. The same words and the
 * same address produce the same key, so a lost answer is not a second send
 * inside Resend's 24-hour window. Changed words or a changed address produce
 * a new key. The same key with a different Resend payload is a 409, so a
 * corrected Driver email has to be a new key or the retry cannot be accepted.
 * The key stays under Resend's 256-character limit. An invitation link is
 * inside the hashed text, so the key does not carry the invitation id.
 */
export function mailIdempotencyKey(
  entryId: string,
  message: IdempotentMail,
  to: string,
): string {
  const hash = createHash('sha256')
    .update(to.trim().toLowerCase())
    .update('\0')
    .update(message.subject)
    .update('\0')
    .update(message.text)
    .update('\0')
    .update(message.html)
    .digest('hex')
  return `${entryId}.${hash}`
}
