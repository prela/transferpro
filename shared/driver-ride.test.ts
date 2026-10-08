import { expect, it } from 'vitest'
import { presentDriverRide } from './driver-ride'

const ride = {
  rideId: 'e1e1e1e1-2222-4222-8222-222222222222',
  pickupAt: '2026-10-06T22:30:00.000Z',
  guestName: 'Ana Anić',
  from: 'Zračna luka Dubrovnik',
  to: 'Hotel Park',
  passengerCount: 3,
  flightNumber: 'OU 384',
  airportMark: true,
  price: '42.50',
  payment: 'cash' as const,
  state: 'assigned' as const,
  mustAccept: false,
}

it('shows the price and cash when the Ride is cash', () => {
  expect(presentDriverRide(ride)).toEqual({
    rideId: ride.rideId,
    pickupAt: ride.pickupAt,
    guestName: ride.guestName,
    from: ride.from,
    to: ride.to,
    passengerCount: 3,
    flightNumber: 'OU 384',
    airportMark: true,
    price: '42.50',
    payment: 'cash',
    state: 'assigned',
    mustAccept: false,
  })
})

it('keeps a Ride that is waiting on acceptance, and still hides a card fare', () => {
  const waiting = presentDriverRide({
    ...ride,
    price: '99.00',
    payment: 'card',
    state: 'assigned',
    mustAccept: true,
  })
  expect(waiting.state).toBe('assigned')
  expect(waiting.mustAccept).toBe(true)
  expect(waiting.price).toBeNull()
  expect(waiting.payment).toBeNull()
  expect(JSON.stringify(waiting)).not.toContain('99.00')
  expect(JSON.stringify(waiting)).not.toContain('card')
})

it('keeps an accepted Ride, including the cash price', () => {
  expect(presentDriverRide({ ...ride, state: 'accepted', mustAccept: true })).toMatchObject({
    state: 'accepted',
    mustAccept: true,
    price: '42.50',
    payment: 'cash',
  })
})

it('refuses an accepted Ride that does not require acceptance', () => {
  expect(() => presentDriverRide({ ...ride, state: 'accepted', mustAccept: false })).toThrow()
})

it('hides the price and the method when the Ride is card', () => {
  const card = presentDriverRide({ ...ride, price: '99.00', payment: 'card' })
  expect(card.price).toBeNull()
  expect(card.payment).toBeNull()
  expect(card.state).toBe('assigned')
  expect(card.mustAccept).toBe(false)
  expect(JSON.stringify(card)).not.toContain('99.00')
  expect(JSON.stringify(card)).not.toContain('card')
})

it('hides the price and the method when the Ride is invoiced to the agency', () => {
  const invoiced = presentDriverRide({ ...ride, price: '80.00', payment: 'invoice_to_agency' })
  expect(invoiced.price).toBeNull()
  expect(invoiced.payment).toBeNull()
  expect(JSON.stringify(invoiced)).not.toContain('80.00')
  expect(JSON.stringify(invoiced)).not.toContain('invoice_to_agency')
})
