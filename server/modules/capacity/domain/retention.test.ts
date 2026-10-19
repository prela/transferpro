import { expect, it } from 'vitest'
import { unavailabilityRetentionCutoff } from './retention'

it('cuts off 90 whole UTC days before now, across a daylight saving change', () => {
  const now = new Date('2026-10-26T03:15:00.000Z')
  expect(unavailabilityRetentionCutoff(now)).toEqual(new Date('2026-07-28T03:15:00.000Z'))
})
