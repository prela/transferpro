import { expect, it } from 'vitest'
import { INVOICE_STATUS_BUDGET } from '../domain/invoice'
import { applyInvoiceStatusReads } from './status'

function created(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    state: 'created' as const,
    toolInvoiceId: `tool-${index}`,
  }
}

it('reads twenty per run, marks those sent, and leaves the rest for the next run', async () => {
  const candidates = Array.from({ length: INVOICE_STATUS_BUDGET + 1 }, (_, index) => created(index + 1))
  const reads: string[] = []
  const logs: Record<string, unknown>[] = []
  const port = {
    async readStatus(toolInvoiceId: string) {
      reads.push(toolInvoiceId)
      return { sent: true, storno: null }
    },
  }
  const log = {
    info(obj: Record<string, unknown>) {
      logs.push(obj)
    },
  }

  const first = await applyInvoiceStatusReads({ candidates, port, log })
  expect(reads).toEqual(candidates.slice(0, INVOICE_STATUS_BUDGET).map(row => row.toolInvoiceId))
  expect(first.every(effect => effect.state === 'sent')).toBe(true)
  expect(logs).toHaveLength(INVOICE_STATUS_BUDGET)
  expect(JSON.stringify(logs)).not.toContain('tool-')

  const leftover = candidates[INVOICE_STATUS_BUDGET]
  if (leftover === undefined)
    throw new Error('missing leftover')
  const second = await applyInvoiceStatusReads({ candidates: [leftover], port, log })
  expect(second).toEqual([{ id: leftover.id, state: 'sent' }])
  expect(reads).toHaveLength(INVOICE_STATUS_BUDGET + 1)
})

it('gives each call its own budget, and stores a found storno without logging it', async () => {
  const tenantA = Array.from({ length: INVOICE_STATUS_BUDGET }, (_, index) => created(index + 1))
  const tenantB = Array.from({ length: INVOICE_STATUS_BUDGET }, (_, index) => created(index + 100))
  let reads = 0
  const port = {
    async readStatus() {
      reads += 1
      return { sent: false, storno: null }
    },
  }
  const log = { info() {} }
  await applyInvoiceStatusReads({ candidates: tenantA, port, log })
  await applyInvoiceStatusReads({ candidates: tenantB, port, log })
  expect(reads).toBe(INVOICE_STATUS_BUDGET * 2)

  const logs: Record<string, unknown>[] = []
  const cancelling = {
    id: '00000000-0000-4000-8000-000000000099',
    state: 'cancelling' as const,
    toolInvoiceId: 'tool-storno',
  }
  const effects = await applyInvoiceStatusReads({
    candidates: [cancelling],
    port: {
      async readStatus() {
        return { sent: true, storno: { number: 'S-9', documentLink: 'https://invoices.invalid/s/9' } }
      },
    },
    log: { info(obj) { logs.push(obj) } },
  })
  expect(effects).toEqual([{
    id: cancelling.id,
    state: 'cancelled',
    stornoNumber: 'S-9',
    stornoLink: 'https://invoices.invalid/s/9',
  }])
  expect(logs).toEqual([{ invoiceId: cancelling.id, state: 'cancelled' }])
  expect(JSON.stringify(logs)).not.toContain('S-9')
  expect(JSON.stringify(logs)).not.toContain('invoices.invalid')
})
