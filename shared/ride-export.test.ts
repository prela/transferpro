import type { RideExportRide } from './ride-export'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'
import { buildRideExportCsv, calendarDayBounds, parseRideExportQuery, rideExportFilename } from './ride-export'
import { PAYMENT_METHODS, RIDE_STATES } from './transfer'

/**
 * 15 Jul 2026 12:00 UTC is 14:00 in Europe/Zagreb (CEST, UTC+2).
 * The expected clock is that known offset, not a second call to the formatter.
 */
const summerNoon = '2026-07-15T12:00:00.000Z'

function ride(overrides: Partial<RideExportRide> = {}): RideExportRide {
  return {
    pickupAt: summerNoon,
    pickup: 'Zračna luka',
    dropOff: 'Hotel Park',
    client: 'Agencija Mora',
    driver: '',
    plate: '',
    price: '42.50',
    payment: 'cash',
    state: 'unassigned',
    ...overrides,
  }
}

const croatianHeader = 'Datum;Vrijeme;Polazište;Odredište;Naručitelj;Vozač;Registarska oznaka;Cijena;Plaćanje;Stanje'
const englishHeader = 'Date;Time;Pickup;Drop-off;Client;Driver;Registration plate;Price;Payment;Status'

it('writes UTF-8 with a BOM, a semicolon, CRLF, and a Croatian header', () => {
  const csv = buildRideExportCsv([ride()], 'Europe/Zagreb', 'hr')
  expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xEF, 0xBB, 0xBF]))
  expect(csv).toBe([
    `\uFEFF${croatianHeader}`,
    '15.07.2026;14:00;Zračna luka;Hotel Park;Agencija Mora;;;42,50;Gotovina;Nedodijeljeno',
    '',
  ].join('\r\n'))
})

it('quotes separators and quotes, keeps č and ž, and leaves the price a number', () => {
  const csv = buildRideExportCsv([ride({
    pickup: 'Čačak; terminal',
    dropOff: 'Hotel "Park"\r\nkat 2',
    client: '=SUM(1)',
    driver: '+Ana',
    plate: '@ZG-1',
    price: '-5.00',
    payment: 'invoice_to_agency',
    state: 'cancelled',
  })], 'Europe/Zagreb', 'hr')
  expect(csv).toBe([
    `\uFEFF${croatianHeader}`,
    '15.07.2026;14:00;"Čačak; terminal";"Hotel ""Park""\r\nkat 2";\'=SUM(1);\'+Ana;\'@ZG-1;-5,00;Račun agenciji;Otkazano',
    '',
  ].join('\r\n'))
  expect(csv).not.toContain('\'-5,00')
})

it('guards a text cell that starts with a tab or a carriage return', () => {
  const csv = buildRideExportCsv([ride({ client: '\t=1', driver: '\rAna' })], 'Europe/Zagreb', 'hr')
  expect(csv).toContain('\'\t=1')
  expect(csv).toContain('"\'\rAna"')
})

it('formats both sides of a daylight-saving change in Europe/Zagreb', () => {
  // 29 Mar 2026 00:30 UTC is 01:30 CET, before the spring-forward.
  // 29 Mar 2026 01:30 UTC is 03:30 CEST, after 02:00 was skipped.
  // 25 Oct 2026 00:30 UTC is the first 02:30 (still CEST).
  // 25 Oct 2026 01:30 UTC is the second 02:30 (CET).
  const csv = buildRideExportCsv([
    ride({ pickupAt: '2026-03-29T00:30:00.000Z', price: '1.00' }),
    ride({ pickupAt: '2026-03-29T01:30:00.000Z', price: '2.00' }),
    ride({ pickupAt: '2026-10-25T00:30:00.000Z', price: '3.00' }),
    ride({ pickupAt: '2026-10-25T01:30:00.000Z', price: '4.00' }),
  ], 'Europe/Zagreb', 'en')
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n')
  expect(lines[0]).toBe(englishHeader)
  expect(lines.slice(1, 5)).toEqual([
    '29.03.2026;01:30;Zračna luka;Hotel Park;Agencija Mora;;;1,00;Cash;Unassigned',
    '29.03.2026;03:30;Zračna luka;Hotel Park;Agencija Mora;;;2,00;Cash;Unassigned',
    '25.10.2026;02:30;Zračna luka;Hotel Park;Agencija Mora;;;3,00;Cash;Unassigned',
    '25.10.2026;02:30;Zračna luka;Hotel Park;Agencija Mora;;;4,00;Cash;Unassigned',
  ])
})

it('uses the office state and payment labels in both locales', () => {
  const hr = JSON.parse(readFileSync(new URL('../i18n/locales/hr.json', import.meta.url), 'utf8')) as {
    transfers: { payments: Record<string, string>, states: Record<string, string>, status: string }
  }
  const en = JSON.parse(readFileSync(new URL('../i18n/locales/en.json', import.meta.url), 'utf8')) as {
    transfers: { payments: Record<string, string>, states: Record<string, string>, status: string }
  }
  expect(croatianHeader.endsWith(hr.transfers.status)).toBe(true)
  expect(englishHeader.endsWith(en.transfers.status)).toBe(true)
  for (const payment of PAYMENT_METHODS) {
    for (const state of RIDE_STATES) {
      const croatian = buildRideExportCsv([ride({ payment, state })], 'Europe/Zagreb', 'hr')
      const english = buildRideExportCsv([ride({ payment, state })], 'Europe/Zagreb', 'en')
      expect(croatian).toContain(`;${hr.transfers.payments[payment]};${hr.transfers.states[state]}`)
      expect(english).toContain(`;${en.transfers.payments[payment]};${en.transfers.states[state]}`)
    }
  }
})

it('keeps an empty export to the header and keeps the caller order', () => {
  expect(buildRideExportCsv([], 'Europe/Zagreb', 'hr')).toBe(`\uFEFF${croatianHeader}\r\n`)
  const csv = buildRideExportCsv([
    ride({ client: 'Drugi', pickupAt: '2026-07-15T16:00:00.000Z' }),
    ride({ client: 'Prvi', pickupAt: '2026-07-15T10:00:00.000Z' }),
  ], 'Europe/Zagreb', 'hr')
  const lines = csv.split('\r\n')
  expect(lines[1]).toContain('Drugi')
  expect(lines[2]).toContain('Prvi')
})

it('accepts 366 calendar days and refuses a longer or reversed range', () => {
  expect(parseRideExportQuery({ from: '2024-01-01', to: '2024-12-31' })).toEqual({
    from: '2024-01-01',
    to: '2024-12-31',
  })
  expect(parseRideExportQuery({ from: '2025-01-01', to: '2026-01-01' })).toEqual({
    from: '2025-01-01',
    to: '2026-01-01',
  })
  expect(parseRideExportQuery({ from: '2026-10-18', to: '2026-10-18' })).toEqual({
    from: '2026-10-18',
    to: '2026-10-18',
  })
  expect(() => parseRideExportQuery({ from: '2024-01-01', to: '2025-01-01' })).toThrow(/Bad request/)
  expect(() => parseRideExportQuery({ from: '2026-10-19', to: '2026-10-18' })).toThrow(/Bad request/)
  expect(() => parseRideExportQuery({ from: '2026-02-31', to: '2026-03-01' })).toThrow(/Bad request/)
  expect(() => parseRideExportQuery({ from: '2026-10-01' })).toThrow(/Bad request/)
})

it('names the file from the range', () => {
  expect(rideExportFilename('2026-10-01', '2026-10-31')).toBe('rides-2026-10-01-2026-10-31.csv')
})

it('puts 02:00 on its own calendar day, not the previous one', () => {
  const atTwo = instantFromWallClock('2026-10-18T02:00', 'Europe/Zagreb')
  const today = calendarDayBounds('2026-10-18', '2026-10-18', 'Europe/Zagreb')
  const yesterday = calendarDayBounds('2026-10-17', '2026-10-17', 'Europe/Zagreb')
  expect(atTwo.getTime() >= today.start.getTime() && atTwo.getTime() < today.end.getTime()).toBe(true)
  expect(atTwo.getTime() >= yesterday.start.getTime() && atTwo.getTime() < yesterday.end.getTime()).toBe(false)
})
