import { expect, it } from 'vitest'
import { workOrderIdempotencyKey } from './idempotency-key'

const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'
const otherId = 'd2d2d2d2-2222-4222-8222-222222222222'
const message = {
  subject: 'Dodijeljeno · 16. 10. 2026. 00:30 · Zračna luka',
  text: 'Gost: Ana',
  html: '<p>Gost: Ana</p>',
}

it('builds the same key from the same entry and the same composed message', () => {
  const key = workOrderIdempotencyKey(entryId, message)
  expect(key).toBe(workOrderIdempotencyKey(entryId, { ...message }))
  expect(key.startsWith(`${entryId}.`)).toBe(true)
  expect(key.length).toBeLessThanOrEqual(256)
})

it('builds a new key when the entry or the composed message changes', () => {
  const key = workOrderIdempotencyKey(entryId, message)
  expect(workOrderIdempotencyKey(otherId, message)).not.toBe(key)
  expect(workOrderIdempotencyKey(entryId, { ...message, text: 'Gost: Marko' })).not.toBe(key)
  expect(workOrderIdempotencyKey(entryId, { ...message, subject: 'Promijenjeno' })).not.toBe(key)
  expect(workOrderIdempotencyKey(entryId, { ...message, html: '<p>Gost: Ana.</p>' })).not.toBe(key)
})
