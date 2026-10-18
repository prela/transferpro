import { createHash } from 'node:crypto'

/**
 * The composed work order. The address is not part of the key:
 * Resend binds the key to the posted payload, and the address is that payload's recipient.
 */
export interface IdempotentWorkOrder {
  readonly subject: string
  readonly text: string
  readonly html: string
}

/**
 * Entry id plus a hash of the composed message (ADR-0045).
 * The same words produce the same key, so a lost answer is not a second send
 * inside Resend's 24-hour window. Changed words produce a new key, so a
 * later attempt states the current facts instead of colliding with the old payload.
 * The key stays under Resend's 256-character limit.
 */
export function workOrderIdempotencyKey(entryId: string, message: IdempotentWorkOrder): string {
  const hash = createHash('sha256')
    .update(message.subject)
    .update('\0')
    .update(message.text)
    .update('\0')
    .update(message.html)
    .digest('hex')
  return `${entryId}.${hash}`
}
