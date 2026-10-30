import type { InvoiceReason, InvoiceState } from '../../../../shared'
import type { InvoiceCreateRequest, ToolInvoice } from './port'
import { expect, it } from 'vitest'
import { INVOICE_CREATE_LEASE_MS, INVOICE_CREATE_SPACING_MS } from '../domain/invoice'
import { memoryCreateGate } from '../testing'
import { performInvoiceCreate } from './create'

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const invoiceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const transferId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const now = new Date('2026-06-01T10:00:00.000Z')

const buyer = {
  legalName: 'Agencija',
  country: 'HR',
  oib: '12345678903',
  vatId: null,
  address: 'Ulica 1',
}

const toolInvoice: ToolInvoice = {
  toolInvoiceId: 'tool-1',
  number: '1-1-1',
  issuedOn: '2026-06-01',
  documentLink: 'https://tool.example/doc/1',
}

interface Row {
  id: string
  transferReference: string
  state: InvoiceState
  clientId: string
  lineText: string
  language: 'hr' | 'en'
  dueDays: number
  vatRate: number
  grossAmount: string
  attemptCount: number
  awaitingLookup: boolean
  askedBy: string
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: invoiceId,
    transferReference: transferId,
    state: 'requested',
    clientId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    lineText: 'Transfer, A – B, 2026-06-01, 2 putnika',
    language: 'hr',
    dueDays: 15,
    vatRate: 25,
    grossAmount: '80.00',
    attemptCount: 0,
    awaitingLookup: false,
    askedBy: 'member-1',
    ...over,
  }
}

function world(behavior: (request: InvoiceCreateRequest) => Promise<
  | { kind: 'created', invoice: ToolInvoice }
  | { kind: 'unknown' }
  | { kind: 'transient' }
  | { kind: 'refused', reason: Exclude<InvoiceReason, 'unavailable'> }
>, found: ToolInvoice | null = null) {
  const rows = new Map<string, Row>([[invoiceId, row()]])
  const creates: string[] = []
  const finds: string[] = []
  const enqueued: Date[] = []
  const logs: Record<string, unknown>[] = []
  const order: string[] = []
  let hold: Promise<void> | null = null
  let release: () => void = () => {}
  const port = {
    async create(request: InvoiceCreateRequest) {
      order.push('create')
      creates.push(request.invoiceId)
      if (hold)
        await hold
      return behavior(request)
    },
    async findByReference(id: string) {
      order.push('find')
      finds.push(id)
      return found
    },
    async readStatus() {
      return { sent: false, storno: null }
    },
  }
  const store = {
    async load(id: string) {
      return rows.get(id) ?? null
    },
    async beginAttempt(id: string) {
      order.push('attempt')
      const current = rows.get(id)
      if (!current || current.state !== 'requested')
        return null
      const next = { ...current, attemptCount: current.attemptCount + 1, awaitingLookup: true }
      rows.set(id, next)
      return next
    },
    async saveCreated(id: string, invoice: ToolInvoice) {
      const current = rows.get(id)
      if (!current)
        return
      rows.set(id, { ...current, state: 'created', awaitingLookup: false })
      void invoice
    },
    async saveRetry(id: string, awaitingLookup: boolean) {
      const current = rows.get(id)
      if (current)
        rows.set(id, { ...current, awaitingLookup, state: 'requested' })
    },
    async saveFailed(id: string, reason: InvoiceReason) {
      const current = rows.get(id)
      if (current)
        rows.set(id, { ...current, state: 'failed' })
      void reason
    },
    async loadBuyer() {
      return buyer
    },
  }
  return {
    rows,
    creates,
    finds,
    enqueued,
    logs,
    order,
    port,
    store,
    holdCreate() {
      hold = new Promise((resolve) => {
        release = resolve
      })
    },
    releaseCreate() {
      release()
      hold = null
    },
    enqueue: {
      async later(_id: string, startAfter: Date) {
        enqueued.push(startAfter)
      },
    },
    log: {
      info(obj: Record<string, unknown>) {
        logs.push(obj)
      },
    },
  }
}

async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (ready())
      return
    await Promise.resolve()
  }
  throw new Error('The create did not start.')
}

it('writes the attempt before the create, and a second press of the job does not create twice while one is in flight', async () => {
  const gate = memoryCreateGate()
  const first = world(async () => ({ kind: 'created', invoice: toolInvoice }))
  first.holdCreate()
  const running = performInvoiceCreate(tenantA, invoiceId, now, first.port, gate, first.store, first.enqueue, first.log)
  await until(() => first.creates.length === 1)
  await performInvoiceCreate(tenantA, invoiceId, now, first.port, gate, first.store, first.enqueue, first.log)
  expect(first.creates).toEqual([invoiceId])
  expect(first.order[0]).toBe('attempt')
  expect(first.order.indexOf('attempt')).toBeLessThan(first.order.indexOf('create'))
  expect(first.enqueued).toEqual([new Date(now.getTime() + 1_000)])
  first.releaseCreate()
  await running
  expect(first.rows.get(invoiceId)?.state).toBe('created')
})

it('lets two Tenants create at the same time', async () => {
  const gate = memoryCreateGate()
  const left = world(async () => ({ kind: 'created', invoice: toolInvoice }))
  const right = world(async () => ({ kind: 'created', invoice: toolInvoice }))
  left.holdCreate()
  right.holdCreate()
  const a = performInvoiceCreate(tenantA, invoiceId, now, left.port, gate, left.store, left.enqueue, left.log)
  const b = performInvoiceCreate(tenantB, invoiceId, now, right.port, gate, right.store, right.enqueue, right.log)
  await until(() => left.creates.length === 1 && right.creates.length === 1)
  expect(left.creates).toEqual([invoiceId])
  expect(right.creates).toEqual([invoiceId])
  left.releaseCreate()
  right.releaseCreate()
  await Promise.all([a, b])
})

it('spaces a second create at least ten seconds after the first', async () => {
  const gate = memoryCreateGate()
  const created = world(async () => ({ kind: 'created', invoice: toolInvoice }))
  await performInvoiceCreate(tenantA, invoiceId, now, created.port, gate, created.store, created.enqueue, created.log)
  created.rows.set(invoiceId, row())
  const again = new Date(now.getTime() + 5_000)
  await performInvoiceCreate(tenantA, invoiceId, again, created.port, gate, created.store, created.enqueue, created.log)
  expect(created.creates).toEqual([invoiceId])
  expect(created.enqueued).toEqual([new Date(now.getTime() + INVOICE_CREATE_SPACING_MS)])
})

it('adopts the invoice a timeout already created, and does not create again', async () => {
  const gate = memoryCreateGate()
  const timed = world(async () => ({ kind: 'unknown' }), toolInvoice)
  await performInvoiceCreate(tenantA, invoiceId, now, timed.port, gate, timed.store, timed.enqueue, timed.log)
  expect(timed.creates).toEqual([invoiceId])
  expect(timed.finds).toEqual([invoiceId])
  expect(timed.rows.get(invoiceId)?.state).toBe('created')
  expect(JSON.stringify(timed.logs)).not.toContain(toolInvoice.number)
  expect(JSON.stringify(timed.logs)).not.toContain(toolInvoice.documentLink)
  expect(JSON.stringify(timed.logs)).not.toContain(buyer.oib)
  expect(JSON.stringify(timed.logs)).not.toContain('80.00')
})

it('fails a refusal at once', async () => {
  const gate = memoryCreateGate()
  const refused = world(async () => ({ kind: 'refused', reason: 'allowance' }))
  await performInvoiceCreate(tenantA, invoiceId, now, refused.port, gate, refused.store, refused.enqueue, refused.log)
  expect(refused.rows.get(invoiceId)?.state).toBe('failed')
  expect(refused.enqueued).toEqual([])
  expect(refused.logs.at(-1)).toMatchObject({ state: 'failed', reason: 'allowance', attemptCount: 1 })
})

it('retries a transient failure after 1, 5, and 30 minutes, then fails as unavailable', async () => {
  const gate = memoryCreateGate()
  const flaky = world(async () => ({ kind: 'transient' }))
  const delays = [60_000, 300_000, 1_800_000]
  let at = now
  for (const delay of delays) {
    flaky.enqueued.length = 0
    await performInvoiceCreate(tenantA, invoiceId, at, flaky.port, gate, flaky.store, flaky.enqueue, flaky.log)
    expect(flaky.rows.get(invoiceId)?.state).toBe('requested')
    expect(flaky.enqueued).toEqual([new Date(at.getTime() + delay)])
    at = new Date(at.getTime() + delay + INVOICE_CREATE_SPACING_MS)
  }
  await performInvoiceCreate(tenantA, invoiceId, at, flaky.port, gate, flaky.store, flaky.enqueue, flaky.log)
  expect(flaky.rows.get(invoiceId)?.state).toBe('failed')
  expect(flaky.logs.at(-1)).toMatchObject({ reason: 'unavailable' })
  expect(flaky.creates).toHaveLength(4)
})

it('a crash after create and before the outcome does not create again', async () => {
  const gate = memoryCreateGate()
  const crashed = world(async () => ({ kind: 'created', invoice: toolInvoice }))
  const save = crashed.store.saveCreated
  crashed.store.saveCreated = async () => {
    throw new Error('crash')
  }
  await expect(performInvoiceCreate(tenantA, invoiceId, now, crashed.port, gate, crashed.store, crashed.enqueue, crashed.log)).rejects.toThrow('crash')
  expect(crashed.creates).toEqual([invoiceId])
  expect(crashed.rows.get(invoiceId)?.awaitingLookup).toBe(true)
  expect(crashed.finds).toEqual([])

  crashed.store.saveCreated = save
  crashed.port.findByReference = async (id: string) => {
    crashed.order.push('find')
    crashed.finds.push(id)
    return toolInvoice
  }
  const later = new Date(now.getTime() + INVOICE_CREATE_SPACING_MS)
  await performInvoiceCreate(tenantA, invoiceId, later, crashed.port, gate, crashed.store, crashed.enqueue, crashed.log)
  expect(crashed.creates).toEqual([invoiceId])
  expect(crashed.finds).toEqual([invoiceId])
  expect(crashed.order.lastIndexOf('find')).toBeGreaterThan(crashed.order.indexOf('create'))
  expect(crashed.rows.get(invoiceId)?.state).toBe('created')
})

it('a killed create stays busy until the lease ends, then the next run looks the invoice up and does not create again', async () => {
  const gate = memoryCreateGate()
  const killed = world(async () => ({ kind: 'created', invoice: toolInvoice }), toolInvoice)
  // The process reserved the slot, committed the attempt, and died inside
  // the port. `finish` is never called, so nothing clears `in_flight`.
  killed.rows.set(invoiceId, row({ attemptCount: 1, awaitingLookup: true }))
  expect(await gate.reserve(tenantA, now)).toEqual({ status: 'ready' })

  const early = new Date(now.getTime() + INVOICE_CREATE_LEASE_MS - 1)
  await performInvoiceCreate(tenantA, invoiceId, early, killed.port, gate, killed.store, killed.enqueue, killed.log)
  expect(killed.creates).toEqual([])
  expect(killed.finds).toEqual([])
  expect(killed.enqueued).toEqual([new Date(early.getTime() + 1_000)])
  expect(killed.rows.get(invoiceId)?.state).toBe('requested')

  const later = new Date(now.getTime() + INVOICE_CREATE_LEASE_MS)
  await performInvoiceCreate(tenantA, invoiceId, later, killed.port, gate, killed.store, killed.enqueue, killed.log)
  expect(killed.creates).toEqual([])
  expect(killed.finds).toEqual([invoiceId])
  expect(killed.order[0]).toBe('find')
  expect(killed.rows.get(invoiceId)?.state).toBe('created')
})
