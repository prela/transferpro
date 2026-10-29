import type { TransferInvoice } from '../../../../shared'
import type { IssueInvoiceSink, IssueTransferFacts } from './issue-invoice'
import { expect, it } from 'vitest'
import { BillingDetailsMissingError, ClientNotInvoiceableError, correctionBlockedByInvoice, InvoiceOfficeOnlyError, InvoicingNotReadyError, issueInvoice, retryInvoice, TransferNotInvoiceableError } from './issue-invoice'

const transferId = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
const invoiceId = '33333333-3333-4333-8333-333333333333'

function transfer(over: Partial<IssueTransferFacts> = {}): IssueTransferFacts {
  return {
    id: transferId,
    state: 'done',
    payment: 'invoice_to_agency',
    price: '80.00',
    mainTransferId: null,
    clientId,
    pickupAt: '2026-06-01T08:00:00.000Z',
    startName: 'Zračna luka',
    endName: 'Hotel Park',
    passengerCount: 2,
    groupPassengerCount: 4,
    clientReference: 'V-19',
    guestName: 'Ana Anić',
    timeZone: 'Europe/Zagreb',
    ...over,
  }
}

const client = { kind: 'agency' as const }
const billing = { complete: true, country: 'HR' as string | null, guestNameOnInvoice: false }
const settings = { tokenSet: true, dueDays: 15, vatRate: 25 as const, lineText: 'Transfer' }

function sink() {
  const calls: string[] = []
  const drafts: string[] = []
  const open: IssueInvoiceSink = {
    async insertRequested(draft) {
      calls.push('insert')
      drafts.push(draft.lineText)
      const invoice: TransferInvoice = { id: draft.id, state: 'requested', number: null, documentLink: null, reason: null }
      return invoice
    },
    async enqueue() {
      calls.push('enqueue')
    },
    async auditRequested() {
      calls.push('audit')
    },
    async replaceRequested(draft) {
      calls.push('replace')
      drafts.push(draft.lineText)
      return { id: draft.id, state: 'requested', number: null, documentLink: null, reason: null }
    },
  }
  return { open, calls, drafts }
}

it('issues once, and a second press returns the same invoice without writing', async () => {
  const first = sink()
  const created = await issueInvoice('dispatcher', 'fake', 'member-1', transfer(), client, billing, settings, null, first.open, () => invoiceId)
  expect(created.id).toBe(invoiceId)
  expect(first.calls).toEqual(['insert', 'audit', 'enqueue'])
  expect(first.drafts[0]).toBe('Transfer, Zračna luka – Hotel Park, 2026-06-01, 4 putnika, V-19')
  const again = sink()
  const repeated = await issueInvoice('admin', 'fake', 'member-1', transfer(), client, billing, settings, created, again.open, () => '44444444-4444-4444-8444-444444444444')
  expect(repeated).toEqual(created)
  expect(again.calls).toEqual([])
})

it('refuses a price of zero, an extra vehicle, and a Ride that is not done, and writes nothing', async () => {
  for (const facts of [
    transfer({ price: '0.00' }),
    transfer({ mainTransferId: '55555555-5555-4555-8555-555555555555' }),
    transfer({ state: 'no-show' }),
    transfer({ payment: 'cash' }),
  ]) {
    const recorded = sink()
    await expect(issueInvoice('dispatcher', 'fake', 'member-1', facts, client, billing, settings, null, recorded.open, () => invoiceId)).rejects.toBeInstanceOf(TransferNotInvoiceableError)
    expect(recorded.calls).toEqual([])
  }
})

it('refuses an individual Client, missing billing details, an adapter that is none, and a Driver', async () => {
  const recorded = sink()
  await expect(issueInvoice('dispatcher', 'fake', 'member-1', transfer(), { kind: 'individual' }, billing, settings, null, recorded.open, () => invoiceId)).rejects.toBeInstanceOf(ClientNotInvoiceableError)
  await expect(issueInvoice('dispatcher', 'fake', 'member-1', transfer(), client, { ...billing, complete: false }, settings, null, recorded.open, () => invoiceId)).rejects.toBeInstanceOf(BillingDetailsMissingError)
  await expect(issueInvoice('dispatcher', 'none', 'member-1', transfer(), client, billing, settings, null, recorded.open, () => invoiceId)).rejects.toBeInstanceOf(InvoicingNotReadyError)
  await expect(issueInvoice('dispatcher', 'fake', 'member-1', transfer(), client, billing, { ...settings, tokenSet: false }, null, recorded.open, () => invoiceId)).rejects.toBeInstanceOf(InvoicingNotReadyError)
  await expect(issueInvoice('driver', 'fake', 'member-1', transfer(), client, billing, settings, null, recorded.open, () => invoiceId)).rejects.toBeInstanceOf(InvoiceOfficeOnlyError)
  expect(recorded.calls).toEqual([])
})

it('puts the guest name on the line only when the billing details ask for it', async () => {
  const recorded = sink()
  await issueInvoice('dispatcher', 'fake', 'member-1', transfer(), client, { ...billing, guestNameOnInvoice: true }, settings, null, recorded.open, () => invoiceId)
  expect(recorded.drafts[0]).toContain('Ana Anić')
  const hidden = sink()
  await issueInvoice('dispatcher', 'fake', 'member-1', transfer(), client, billing, settings, null, hidden.open, () => invoiceId)
  expect(hidden.drafts[0]).not.toContain('Ana')
})

it('rebuilds a failed invoice under the same id, and a locking invoice blocks the price', async () => {
  const failed: TransferInvoice = { id: invoiceId, state: 'failed', number: null, documentLink: null, reason: 'rejected' }
  const recorded = sink()
  const next = await retryInvoice('dispatcher', 'fake', 'member-2', transfer({ price: '90.00' }), client, billing, settings, failed, recorded.open)
  expect(next.id).toBe(invoiceId)
  expect(recorded.calls).toEqual(['replace', 'audit', 'enqueue'])
  expect(recorded.drafts[0]).not.toContain('90.00')
  expect(recorded.drafts[0]).toContain('4 putnika')
  expect(correctionBlockedByInvoice({ state: 'requested' }, ['price'])).toBe(true)
  expect(correctionBlockedByInvoice({ state: 'failed' }, ['price'])).toBe(false)
  expect(correctionBlockedByInvoice({ state: 'created' }, ['guestName'])).toBe(false)
})
