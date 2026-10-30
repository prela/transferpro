import { expect, it } from 'vitest'
import { INVOICE_CREATE_LEASE_MS, INVOICE_CREATE_SPACING_MS, invoiceLanguage, invoiceLineText, retryDelayAfterAttempt } from './invoice'

const route = {
  lineText: 'Transfer',
  startName: 'Zračna luka',
  endName: 'Hotel Park',
  pickupDate: '2026-06-01',
  passengerCount: 4,
  language: 'hr' as const,
  clientReference: 'V-19',
  guestName: null,
}

it('builds the Croatian line with the route, the date, the ordered count, and the reference', () => {
  expect(invoiceLineText(route)).toBe('Transfer, Zračna luka – Hotel Park, 2026-06-01, 4 putnika, V-19')
})

it('adds the guest name only when the caller passes one', () => {
  expect(invoiceLineText({ ...route, guestName: 'Ana Anić' })).toBe(
    'Transfer, Zračna luka – Hotel Park, 2026-06-01, 4 putnika, V-19, Ana Anić',
  )
  expect(invoiceLineText(route)).not.toContain('Ana')
})

it('uses English and the singular when the Client is not Croatian and the count is one', () => {
  expect(invoiceLanguage('HR')).toBe('hr')
  expect(invoiceLanguage('DE')).toBe('en')
  expect(invoiceLineText({
    lineText: 'Transfer',
    startName: 'Airport',
    endName: 'Hotel',
    pickupDate: '2026-06-01',
    passengerCount: 1,
    language: 'en',
    clientReference: null,
    guestName: null,
  })).toBe('Transfer, Airport – Hotel, 2026-06-01, 1 passenger')
})

it('does not put a vehicle count on the line', () => {
  expect(invoiceLineText(route)).not.toMatch(/vozil/i)
  expect(invoiceLineText({ ...route, language: 'en', passengerCount: 4 })).toContain('4 passengers')
})

it('retries after 1, 5, and 30 minutes, then stops', () => {
  expect(retryDelayAfterAttempt(1)).toBe(60_000)
  expect(retryDelayAfterAttempt(2)).toBe(300_000)
  expect(retryDelayAfterAttempt(3)).toBe(1_800_000)
  expect(retryDelayAfterAttempt(4)).toBeNull()
  expect(INVOICE_CREATE_SPACING_MS).toBe(10_000)
  // Two 30s port calls, twice over. Longer than the 10s spacing.
  expect(INVOICE_CREATE_LEASE_MS).toBe(120_000)
})
