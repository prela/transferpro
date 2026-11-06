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

const stubPort = {
  async create() {
    return { kind: 'unknown' as const }
  },
  async findByReference() {
    return null
  },
  async readStatus() {
    return { sent: false, storno: null }
  },
  async storno() {
    return { kind: 'unknown' as const }
  },
  async findStorno() {
    return null
  },
}

it('runs the create job for the current-tool adapter and does not require the fake', async () => {
  selectInvoicingMode('current')
  try {
    let stepped = false
    await handleInvoiceCreateJob(job, async () => {
      stepped = true
      return undefined as never
    }, queue, { info() {} } as never, stubPort)
    expect(stepped).toBe(true)
  }
  finally {
    selectInvoicingMode('none')
  }
})

it('does not run the create job when INVOICING is none', async () => {
  selectInvoicingMode('none')
  let stepped = false
  await handleInvoiceCreateJob(job, async () => {
    stepped = true
    return undefined as never
  }, queue, { info() {} } as never, stubPort)
  expect(stepped).toBe(false)
})
