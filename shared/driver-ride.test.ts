import { expect, it } from 'vitest'
import { leadDriverRide, presentDriverRide } from './driver-ride'

const ride = {
  rideId: 'e1e1e1e1-2222-4222-8222-222222222222',
  pickupAt: '2026-10-06T22:30:00.000Z',
  guestName: 'Ana Anić',
  from: 'Zračna luka Dubrovnik',
  to: 'Hotel Park',
  passengerCount: 3,
  flightNumber: 'OU 384',
  landingAt: null,
  expectedArrival: null,
  airportMark: true,
  clientName: 'Agencija Mora',
  clientKind: 'agency' as const,
  clientReference: null,
  groupRole: null,
  fromAddress: null,
  toAddress: 'Masarykov put 1',
  luggageCount: 2,
  childSeatCount: 1,
  note: null,
  tabla: '',
  registrationPlate: 'DU200AA',
  price: '42.50',
  payment: 'cash' as const,
  state: 'assigned' as const,
  mustAccept: false,
  fromMapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Zra%C4%8Dna+luka+Dubrovnik',
  toMapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Masarykov+put+1',
}

it('shows the price and cash when the Ride is cash, and does not include a Driver email', () => {
  const shown = presentDriverRide(ride)
  expect(shown).not.toHaveProperty('email')
  expect(shown).toEqual({
    rideId: ride.rideId,
    pickupAt: ride.pickupAt,
    guestName: ride.guestName,
    from: ride.from,
    to: ride.to,
    passengerCount: 3,
    flightNumber: 'OU 384',
    landingAt: null,
    expectedArrival: null,
    airportMark: true,
    clientName: 'Agencija Mora',
    clientKind: 'agency',
    clientReference: null,
    inGroup: false,
    fromAddress: null,
    toAddress: 'Masarykov put 1',
    luggageCount: 2,
    childSeatCount: 1,
    note: null,
    tabla: null,
    registrationPlate: 'DU200AA',
    price: '42.50',
    payment: 'cash',
    state: 'assigned',
    mustAccept: false,
    fromMapsUrl: ride.fromMapsUrl,
    toMapsUrl: ride.toMapsUrl,
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

it('keeps the note, the tabla, and a zero count on a card Ride, and still hides the fare', () => {
  const card = presentDriverRide({
    ...ride,
    price: '99.00',
    payment: 'card',
    guestName: 'Iva Card',
    note: 'Voucher fare 99.00',
    tabla: 'GOSPOĐA HORVAT',
    luggageCount: 0,
    childSeatCount: 0,
    clientKind: 'individual',
  })
  expect(card.clientName).toBe('Agencija Mora')
  expect(card.clientKind).toBe('individual')
  expect(card.note).toBe('Voucher fare 99.00')
  expect(card.tabla).toBe('GOSPOĐA HORVAT')
  expect(card.tabla).not.toBe(card.guestName)
  expect(card.luggageCount).toBe(0)
  expect(card.childSeatCount).toBe(0)
  expect(card.fromAddress).toBeNull()
  expect(card.toAddress).toBe('Masarykov put 1')
  expect(card.registrationPlate).toBe('DU200AA')
  expect(card.price).toBeNull()
  expect(card.payment).toBeNull()
})

it('omits a blank tabla and a blank address', () => {
  expect(presentDriverRide({ ...ride, tabla: '   ', toAddress: '  ' })).toMatchObject({
    tabla: null,
    toAddress: null,
    luggageCount: 2,
  })
})

it('hides the price and the method when the Ride is invoiced to the agency', () => {
  const invoiced = presentDriverRide({ ...ride, price: '80.00', payment: 'invoice_to_agency' })
  expect(invoiced.price).toBeNull()
  expect(invoiced.payment).toBeNull()
  expect(JSON.stringify(invoiced)).not.toContain('80.00')
  expect(JSON.stringify(invoiced)).not.toContain('invoice_to_agency')
})

it('states the client reference and marks a main Transfer, and still shows a cash price', () => {
  const main = presentDriverRide({
    ...ride,
    passengerCount: 3,
    clientReference: '  V-19  ',
    groupRole: 'main',
    price: '40.00',
  })
  expect(main.clientReference).toBe('V-19')
  expect(main.inGroup).toBe(true)
  expect(main.passengerCount).toBe(3)
  expect(main.price).toBe('40.00')
  expect(main.payment).toBe('cash')
  expect(main).not.toHaveProperty('groupPassengerCount')
  expect(main).not.toHaveProperty('groupRole')
})

it('hides the fare of an extra vehicle for cash, card, and invoice, and keeps its own passenger count', () => {
  for (const payment of ['cash', 'card', 'invoice_to_agency'] as const) {
    const extra = presentDriverRide({
      ...ride,
      passengerCount: 2,
      clientReference: 'V-19',
      groupRole: 'extra',
      price: '0.00',
      payment,
    })
    expect(extra.passengerCount).toBe(2)
    expect(extra.clientReference).toBe('V-19')
    expect(extra.inGroup).toBe(true)
    expect(extra.price).toBeNull()
    expect(extra.payment).toBeNull()
    expect(JSON.stringify(extra)).not.toContain(`"price":"0.00"`)
    expect(JSON.stringify(extra)).not.toContain(`"payment":"${payment}"`)
    expect(extra).not.toHaveProperty('groupPassengerCount')
  }
})

it('omits a blank client reference and does not mark a Ride that is not in a group', () => {
  const shown = presentDriverRide({ ...ride, clientReference: '   ', groupRole: null })
  expect(shown.clientReference).toBeNull()
  expect(shown.inGroup).toBe(false)
})

function shown(rideId: string, pickupAt: string) {
  return presentDriverRide({ ...ride, rideId, pickupAt })
}

it('leads with the earliest pickup and keeps the later Rides in that order', () => {
  const early = shown('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-06T08:00:00.000Z')
  const mid = shown('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-10-06T12:00:00.000Z')
  const late = shown('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-10-06T18:00:00.000Z')
  expect(leadDriverRide([late, early, mid])).toEqual({ next: early, rest: [mid, late] })
})

it('breaks a tied pickup by ride id and returns nothing when the list is empty', () => {
  const first = shown('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-06T08:00:00.000Z')
  const second = shown('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-10-06T08:00:00.000Z')
  expect(leadDriverRide([second, first])).toEqual({ next: first, rest: [second] })
  expect(leadDriverRide([])).toEqual({ next: null, rest: [] })
})
