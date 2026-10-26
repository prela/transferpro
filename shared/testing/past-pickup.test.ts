import { expect, it } from 'vitest'
import { operationalDateInTimeZone } from '../date'
import { pastPickupOnThisOperationalDay } from './past-pickup'

it('stays on this operational day just after 05:00 and one minute before noon', () => {
  // 2026-10-26 is CET (UTC+1). Noon in Zagreb is 11:00Z; 05:00:30 is 04:00:30Z.
  const noon = new Date('2026-10-26T11:00:00.000Z')
  const atNoon = pastPickupOnThisOperationalDay(noon)
  expect(atNoon.toISOString()).toBe('2026-10-26T10:59:00.000Z')
  expect(operationalDateInTimeZone('Europe/Zagreb', atNoon, 5)).toBe('2026-10-26')

  const justAfter = new Date('2026-10-26T04:00:30.000Z')
  const pickup = pastPickupOnThisOperationalDay(justAfter)
  expect(pickup.toISOString()).toBe('2026-10-26T04:00:00.000Z')
  expect(pickup.getTime()).toBeLessThan(justAfter.getTime())
  expect(operationalDateInTimeZone('Europe/Zagreb', pickup, 5)).toBe('2026-10-26')
})
