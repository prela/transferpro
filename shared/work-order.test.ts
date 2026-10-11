import { expect, it } from 'vitest'
import { composeAssignedWorkOrder } from './work-order'

/**
 * 15 Oct 2026 22:30 UTC is 16 Oct 00:30 in Europe/Zagreb (CEST, UTC+2).
 * The string is the wall clock a Driver in that zone reads, not UTC.
 */
const pickupAt = new Date('2026-10-15T22:30:00.000Z')

const facts = {
  locale: 'hr' as const,
  timeZone: 'Europe/Zagreb',
  pickupAt,
  pickupPlace: 'Zračna luka <Dubrovnik>',
  dropOffPlace: 'Hotel Park',
  guestName: 'Ana & Iva',
  tabla: 'ANA',
  passengerCount: 3,
  luggageCount: 2,
  childSeatCount: 1,
  flightNumber: 'OU412',
  clientName: 'Agencija Mora',
  vehicleName: 'Mercedes Vito',
  vehiclePlate: 'DU100AA',
  note: 'Čekaj na izlazu',
  payment: 'cash' as const,
  price: '42.50',
}

it('writes an assigned work order in the tenant locale and time zone', () => {
  const message = composeAssignedWorkOrder(facts)
  expect(message.subject).toBe('Dodijeljeno · 16. 10. 2026. 00:30 · Zračna luka <Dubrovnik>')
  expect(message.text).toBe([
    'Dodijeljeno',
    'Polazak: 16. 10. 2026. 00:30',
    'Polazište: Zračna luka <Dubrovnik>',
    'Odredište: Hotel Park',
    'Gost: Ana & Iva',
    'Tabla: ANA',
    'Putnici: 3',
    'Prtljaga: 2',
    'Dječje sjedalice: 1',
    'Let: OU412',
    'Klijent: Agencija Mora',
    'Vozilo: Mercedes Vito',
    'Registracija: DU100AA',
    'Napomena: Čekaj na izlazu',
    'Cijena: 42,50',
    'Plaćanje: Gotovina',
  ].join('\n'))
  expect(message.html).toContain('Zračna luka &lt;Dubrovnik&gt;')
  expect(message.html).toContain('Ana &amp; Iva')
  expect(message.html).not.toContain('<a')
  expect(message.html).not.toContain('href=')
  expect(message.text.toLowerCase()).not.toContain('prihvat')
  expect(message.text).not.toMatch(/https?:/)
})

it('uses the tenant locale on the facts, so an English tenant is English even for a Croatian UI', () => {
  const message = composeAssignedWorkOrder({
    ...facts,
    locale: 'en',
    timeZone: 'UTC',
    payment: 'card',
    flightNumber: null,
    vehicleName: null,
    note: null,
    tabla: '',
  })
  expect(message.subject).toBe('Assigned · 15/10/2026, 22:30 · Zračna luka <Dubrovnik>')
  expect(message.text).toContain('Assigned')
  expect(message.text).toContain('Departure: 15/10/2026, 22:30')
  expect(message.text).toContain('Pickup: Zračna luka <Dubrovnik>')
  expect(message.text).toContain('Drop-off: Hotel Park')
  expect(message.text).toContain('Guest: Ana & Iva')
  expect(message.text).toContain('Meet sign: ')
  expect(message.text).toContain('Passengers: 3')
  expect(message.text).toContain('Luggage: 2')
  expect(message.text).toContain('Child seats: 1')
  expect(message.text).not.toContain('Flight')
  expect(message.text).not.toContain('OU412')
  expect(message.text).toContain('Client: Agencija Mora')
  expect(message.text).not.toContain('Vehicle:')
  expect(message.text).toContain('Plate: DU100AA')
  expect(message.text).toContain('Note: ')
  expect(message.text).not.toContain('42.50')
  expect(message.text).not.toContain('42,50')
  expect(message.text).not.toContain('Cash')
  expect(message.text).not.toContain('Gotovina')
  expect(message.text.toLowerCase()).not.toContain('accept')
})

it('omits the payment line for invoice to agency and a blank flight', () => {
  const message = composeAssignedWorkOrder({
    ...facts,
    payment: 'invoice_to_agency',
    flightNumber: '   ',
    price: '77.00',
  })
  expect(message.text).not.toContain('Let:')
  expect(message.text).not.toContain('77')
  expect(message.text).not.toContain('Plaćanje')
  expect(message.text).not.toContain('Cijena')
})
