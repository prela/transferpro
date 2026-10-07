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
  })
})

it('hides the price and the method when the Ride is card', () => {
  const card = presentDriverRide({ ...ride, price: '99.00', payment: 'card' })
  expect(card.price).toBeNull()
  expect(card.payment).toBeNull()
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
