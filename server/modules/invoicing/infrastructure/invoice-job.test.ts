import type { JobQueue, QueuedJob } from '../../../core/index'
import { expect, it } from 'vitest'
import { handleInvoiceCreateJob } from './invoice-job'
import { selectInvoicingMode } from './mode'

const job: QueuedJob = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'invoice-create',
  tenantId: '22222222-2222-4222-8222-222222222222',
  data: { invoiceId: '33333333-3333-4333-8333-333333333333' },
}

const queue = {
  enqueue: async () => {},
  handleNext: async () => null,
  schedule: async () => {},
  workScheduled: async () => {},
  work: async () => {},
  close: async () => {},
} as JobQueue

it('does not call the fake when INVOICING is current', async () => {
  selectInvoicingMode('current')
  try {
    let stepped = false
    await handleInvoiceCreateJob(job, async () => {
      stepped = true
      return undefined as never
    }, queue, { info() {} } as never)
    expect(stepped).toBe(false)
  }
  finally {
    selectInvoicingMode('none')
  }
})
