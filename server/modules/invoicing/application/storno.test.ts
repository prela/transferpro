import { expect, it } from 'vitest'
import { fakeInvoicingPort } from '../testing'
import { applyInvoiceStatusReads } from './status'
import { performInvoiceStorno } from './storno'

const invoiceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/**
 * A memory of one cancelling invoice. `markCalled` commits the flag the
 * way the database step does: the next load sees it.
 */
function store() {
  const row = {
    id: invoiceId,
    state: 'cancelling' as 'cancelling' | 'cancelled',
    toolInvoiceId: 'fake-1',
    stornoCalled: false,
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
