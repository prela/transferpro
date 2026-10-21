import { expect, it } from 'vitest'
import { fakeCapacityPorts } from '../testing'
import { freePartners } from './free-partners'

const partnerId = 'a1a1a1a1-1111-4111-8111-111111111111'
const otherPartnerId = 'a2a2a2a2-2222-4222-8222-222222222222'

function at(hours: number): Date {
  return new Date(Date.UTC(2026, 9, 20, hours))
}

it('counts only an active Partner that no window covers', async () => {
  const { ports, asked } = fakeCapacityPorts([], undefined, [{
    id: 'd1d1d1d1-1111-4111-8111-111111111111',
    driverId: null,
    vehicleId: null,
    partnerId,
    startsAt: at(10),
    endsAt: at(12),
  }])
  const free = await freePartners(ports.windows, async () => [partnerId, otherPartnerId], { from: at(11), to: at(12) })
  expect(free).toEqual([otherPartnerId])
  expect(asked.ridesOf).toEqual([])
  expect(asked.ridesDuring).toEqual([])
  expect(asked.windows[0]?.partnerIds).toEqual([partnerId, otherPartnerId])
})

it('asks for no windows when the Tenant has no active Partner', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await expect(freePartners(ports.windows, async () => [], { from: at(10), to: at(11) })).resolves.toEqual([])
  expect(asked.windows).toEqual([])
})
