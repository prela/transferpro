import { expect, it } from 'vitest'
import { fakeInvoicingPort } from '../testing'
import { applyInvoiceStatusReads } from './status'
import { performInvoiceStorno } from './storno'

const invoiceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/**
 * A memory of one cancelling invoice. `markCalled` commits the flag the
 * way the database step does: the next load sees it.
 */
function store(prior: 'created' | 'sent' = 'created') {
  const row = {
    id: invoiceId,
    state: 'cancelling' as 'cancelling' | 'cancelled' | 'created' | 'sent',
    toolInvoiceId: 'fake-1',
    stornoCalled: false,
    prior,
  }
  const saved: { number: string, documentLink: string }[] = []
  return {
    saved,
    row,
    async load() {
      return { ...row }
    },
    async markCalled() {
      if (row.stornoCalled || row.state !== 'cancelling')
        return false
      row.stornoCalled = true
      return true
    },
    async saveCancelled(_id: string, storno: { number: string, documentLink: string }) {
      row.state = 'cancelled'
      saved.push({ number: storno.number, documentLink: storno.documentLink })
    },
    /**
     * The claim is already committed. A refusal puts the invoice back
     * to the state the office asked from, and clears that claim.
     */
    async restore() {
      if (row.state !== 'cancelling' || !row.stornoCalled)
        return null
      row.state = row.prior
      row.stornoCalled = false
      return row.prior
    },
  }
}

it('calls storno once after a timeout, then the status job finds the negative invoice', async () => {
  const port = fakeInvoicingPort({ stornoOutcome: 'unknown', hideStorno: true })
  const memory = store()
  const calls = { n: 0 }
  const wrapped = {
    async storno(toolInvoiceId: string) {
      calls.n += 1
      return port.storno(toolInvoiceId)
    },
    findStorno: (toolInvoiceId: string) => port.findStorno(toolInvoiceId),
  }
  const log = { info() {} }
  await performInvoiceStorno(invoiceId, wrapped, memory, log)
  await performInvoiceStorno(invoiceId, wrapped, memory, log)
  expect(calls.n).toBe(1)
  expect(memory.saved).toEqual([])
  expect(memory.row.state).toBe('cancelling')

  port.revealStorno()
  const effects = await applyInvoiceStatusReads({
    candidates: [{ id: invoiceId, state: 'cancelling', toolInvoiceId: 'fake-1' }],
    port,
    log,
  })
  expect(effects).toEqual([{
    id: invoiceId,
    state: 'cancelled',
    stornoNumber: 'S-1',
    stornoLink: 'https://invoices.invalid/storno/1',
    stornoSent: false,
  }])
  expect(JSON.stringify(effects)).not.toContain('fake-1')
})

it('puts the invoice back when the tool refuses the storno', async () => {
  const port = fakeInvoicingPort({ stornoOutcome: 'refused' })
  const memory = store('sent')
  const lines: Record<string, unknown>[] = []
  let finds = 0
  const wrapped = {
    storno: (toolInvoiceId: string) => port.storno(toolInvoiceId),
    async findStorno(toolInvoiceId: string) {
      finds += 1
      return port.findStorno(toolInvoiceId)
    },
  }
  await performInvoiceStorno(invoiceId, wrapped, memory, {
    info(obj) {
      lines.push(obj)
    },
  })
  expect(memory.row.state).toBe('sent')
  expect(memory.row.stornoCalled).toBe(false)
  expect(finds).toBe(0)
  expect(lines).toEqual([{ invoiceId, state: 'sent', reason: 'rejected' }])
  const text = JSON.stringify(lines)
  expect(text).not.toContain('S-')
  expect(text).not.toContain('F-')
  expect(text).not.toContain('https://')
})
