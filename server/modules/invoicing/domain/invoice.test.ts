import { expect, it } from 'vitest'
import { instantFromWallClock } from '../../../../shared'
import { INVOICE_CREATE_LEASE_MS, INVOICE_CREATE_SPACING_MS, INVOICE_STATUS_BUDGET, invoiceLanguage, invoiceLineText, invoiceStatusEffect, paymentReportingReminderDue, retryDelayAfterAttempt, statusReadsThisRun } from './invoice'

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

const zone = 'Europe/Zagreb'

it('reminds on the 15th through the 20th in the Tenant zone, and not without a sent Croatian invoice', () => {
  const on = (wall: string, sent: boolean) => paymentReportingReminderDue(instantFromWallClock(wall, zone), zone, sent)
  expect(on('2026-10-14T23:59', true)).toBe(false)
  expect(on('2026-10-15T00:00', true)).toBe(true)
  expect(on('2026-10-20T23:59', true)).toBe(true)
  expect(on('2026-10-21T00:00', true)).toBe(false)
  expect(on('2026-10-15T12:00', false)).toBe(false)
  // The UTC date is still the 14th when Auckland is already the 15th.
  const auckland = 'Pacific/Auckland'
  expect(paymentReportingReminderDue(instantFromWallClock('2026-10-15T00:00', auckland), auckland, true)).toBe(true)
  expect(paymentReportingReminderDue(instantFromWallClock('2026-10-14T23:59', auckland), auckland, true)).toBe(false)
})

it('reads twenty status rows and turns a sent create, or a found storno, into the next state', () => {
  const rows = Array.from({ length: INVOICE_STATUS_BUDGET + 1 }, (_, index) => index)
  expect(statusReadsThisRun(rows)).toHaveLength(INVOICE_STATUS_BUDGET)
  expect(statusReadsThisRun(rows)[0]).toBe(0)
  const created = {
    id: '00000000-0000-4000-8000-000000000001',
    state: 'created' as const,
    toolInvoiceId: 'tool-1',
  }
  expect(invoiceStatusEffect(created, { sent: true, storno: null })).toEqual({ id: created.id, state: 'sent' })
  expect(invoiceStatusEffect(created, { sent: false, storno: null })).toEqual({ id: created.id, state: 'created' })
  const cancelling = { ...created, state: 'cancelling' as const }
  expect(invoiceStatusEffect(cancelling, {
    sent: true,
    storno: { number: 'S-1', documentLink: 'https://invoices.invalid/s/1' },
  })).toEqual({
    id: created.id,
    state: 'cancelled',
    stornoNumber: 'S-1',
    stornoLink: 'https://invoices.invalid/s/1',
  })
  expect(invoiceStatusEffect(cancelling, { sent: true, storno: null }).state).toBe('cancelling')
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
