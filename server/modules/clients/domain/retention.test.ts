import { expect, it } from 'vitest'
import { CONTACT_PERSON_RETENTION_DAYS, contactPersonRetentionCutoff } from './retention'

const day = 24 * 60 * 60 * 1000
const now = new Date('2026-10-19T03:45:00.000Z')

it('keeps 90 days: a person removed exactly 90 days ago sits on the cutoff and stays', () => {
  expect(CONTACT_PERSON_RETENTION_DAYS).toBe(90)
  const cutoff = contactPersonRetentionCutoff(now)
  expect(cutoff.toISOString()).toBe('2026-07-21T03:45:00.000Z')
  // The delete takes rows removed strictly before the cutoff.
  expect(now.getTime() - 89 * day).toBeGreaterThan(cutoff.getTime())
  expect(now.getTime() - 90 * day).toBe(cutoff.getTime())
  expect(now.getTime() - 91 * day).toBeLessThan(cutoff.getTime())
})

it('counts whole 24-hour days, so a daylight saving change does not move the cutoff', () => {
  const afterChange = new Date('2026-11-01T12:00:00.000Z')
  expect(afterChange.getTime() - contactPersonRetentionCutoff(afterChange).getTime()).toBe(90 * day)
})
