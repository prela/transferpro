import type { InvoiceCreateRequest } from './port'
import { expect, it } from 'vitest'
import { fakeInvoicingPort } from '../testing'
import { withdrawFailedInvoice } from './withdraw'

const invoiceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const transferId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function shown(id: string, state: 'created' | 'withdrawn') {
  return { id, state, number: null, documentLink: null, reason: null, stornoNumber: null, stornoLink: null }
}

function memory() {
  const adopted: string[] = []
  const withdrawn: string[] = []
  return {
    adopted,
    withdrawn,
    async adopt(id: string) {
      adopted.push(id)
      return shown(id, 'created')
    },
    async withdraw(id: string) {
      withdrawn.push(id)
      return shown(id, 'withdrawn')
    },
  }
}

const request: InvoiceCreateRequest = {
  invoiceId,
  clientId: invoiceId,
  lineText: 'Transfer',
  language: 'hr',
  dueDays: 15,
  vatRate: 25,
  grossAmount: '80.00',
  quantity: 1,
  buyerType: 'b2b',
  buyer: { legalName: 'Agencija', country: 'HR', oib: null, vatId: null, address: 'Ulica 1' },
}

const failed = {
  id: invoiceId,
  state: 'failed' as const,
  transferReference: transferId,
}

it('adopts a failed invoice when the tool already has it, and withdraws when it does not', async () => {
  const present = fakeInvoicingPort()
  await present.create(request)
  const adopted = memory()
  const created = await withdrawFailedInvoice('admin', 'admin-1', failed, present, adopted)
  expect(created.state).toBe('created')
  expect(adopted.adopted).toEqual([invoiceId])
  expect(adopted.withdrawn).toEqual([])

  const absent = fakeInvoicingPort()
  const cleared = memory()
  const withdrawn = await withdrawFailedInvoice('admin', 'admin-1', failed, absent, cleared)
  expect(withdrawn.state).toBe('withdrawn')
  expect(cleared.withdrawn).toEqual([invoiceId])
  expect(cleared.adopted).toEqual([])
})

it('refuses a dispatcher before any lookup', async () => {
  let looked = false
  const port = {
    async findByReference() {
      looked = true
      return null
    },
  }
  await expect(withdrawFailedInvoice('dispatcher', 'member-1', failed, port, memory())).rejects.toMatchObject({
    statusCode: 403,
  })
  expect(looked).toBe(false)
})
