import { expect, it } from 'vitest'
import { boardOccupationRange } from './board-range'

const hour = 60 * 60 * 1000
const reach = 48 * hour
const day = {
  start: new Date('2026-10-19T03:00:00.000Z'),
  end: new Date('2026-10-20T03:00:00.000Z'),
}

it('reaches two maximum windows before and after the operational day', () => {
  expect(boardOccupationRange(day, [{ pickupAt: new Date('2026-10-19T08:00:00.000Z'), landingAt: null }])).toEqual({
    from: new Date(day.start.getTime() - reach),
    to: new Date(day.end.getTime() + reach),
  })
})

it('stretches the upper bound to the latest pickup or landing on the listed Rides', () => {
  const lateLanding = new Date('2026-10-21T10:00:00.000Z')
  const latePickup = new Date('2026-10-20T06:00:00.000Z')
  expect(boardOccupationRange(day, [
    { pickupAt: new Date('2026-10-19T08:00:00.000Z'), landingAt: lateLanding },
    { pickupAt: latePickup, landingAt: null },
  ]).to).toEqual(new Date(lateLanding.getTime() + reach))
})
