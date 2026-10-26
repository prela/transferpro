import { expect, it, vi } from 'vitest'
import { captureLogs } from '../../../core/testing'

const note = vi.hoisted(() => vi.fn())
const stale = vi.hoisted(() => vi.fn())
const currentFacts = vi.hoisted(() => vi.fn())

vi.mock('../../mail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../mail')>()
  return {
    ...actual,
    markWorkOrderStale: stale,
    noteWorkOrderAttempt: note,
    recordWorkOrder: vi.fn(),
  }
})

vi.mock('./work-order-attempt', () => ({
  readWorkOrderCurrentFacts: currentFacts,
}))

vi.mock('../../tenancy', () => ({
  ResendTransportError: class ResendTransportError extends Error {
    constructor() {
      super('The mail provider rejected the message.')
      this.name = 'ResendTransportError'
    }
  },
  withTenantFromSession: async (
    _headers: Headers,
    run: (scope: { transaction: object }) => Promise<unknown>,
  ) => run({ transaction: {} }),
}))

const { deliverStagedWorkOrder } = await import('./work-order')

const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const email = 'ana@example.test'

function staged(pickupAt: Date) {
  return {
    entryId,
    status: 'assigned' as const,
    order: {
      rideId: 'e1e1e1e1-2222-4222-8222-222222222222',
      driverId,
      vehicleId: 'c1c1c1c1-1111-4111-8111-111111111111',
      email,
      locale: 'hr' as const,
      timeZone: 'Europe/Zagreb',
      pickupAt,
      pickupPlace: 'Zračna luka Dubrovnik',
      dropOffPlace: 'Hotel Park',
      guestName: 'Ana Tajna',
      tabla: 'TABLA-TAJNA',
      passengerCount: 2,
      luggageCount: 1,
      childSeatCount: 0,
      flightNumber: 'OU412',
      clientName: 'Agencija Mora',
      clientReference: null,
      groupRole: null,
      vehicleName: 'Mercedes Vito',
      vehiclePlate: 'DU9SECRET',
      note: null,
      payment: 'cash' as const,
      price: '77.50',
    },
  }
}

function current() {
  return {
    status: 'assigned' as const,
    rideFinished: false,
    rideCancelled: false,
    superseded: false,
  }
}

it('returns the office notice when noting the attempt fails, and logs only the entry id', async () => {
  currentFacts.mockResolvedValue(current())
  note.mockRejectedValue(new Error(`db ${email} Ana Tajna`))
  const logs = captureLogs()
  const notice = await deliverStagedWorkOrder(new Headers(), staged(new Date('2099-01-01T00:00:00.000Z')), {
    async sendWorkOrder() {},
  }, logs.logger)
  expect(notice).toEqual({ driverId, outcome: 'sent' })
  const [line] = logs.lines()
  const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest } = line ?? {}
  expect(rest).toEqual({ event: 'mail_outbox.note_failed', entryId })
  expect(JSON.stringify(line)).not.toContain(email)
  expect(JSON.stringify(line)).not.toContain('Ana Tajna')
})

it('logs only the entry id when the current-ness read fails, and still sends the snapshot', async () => {
  currentFacts.mockRejectedValue(new Error(`db ${email} Ana Tajna`))
  note.mockResolvedValue(undefined)
  const logs = captureLogs()
  const notice = await deliverStagedWorkOrder(new Headers(), staged(new Date('2099-01-01T00:00:00.000Z')), {
    async sendWorkOrder() {},
  }, logs.logger)
  expect(notice).toEqual({ driverId, outcome: 'sent' })
  const [line] = logs.lines()
  const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest } = line ?? {}
  expect(rest).toEqual({ event: 'mail_outbox.current_check_failed', entryId })
  expect(JSON.stringify(line)).not.toContain(email)
  expect(JSON.stringify(line)).not.toContain('Ana Tajna')
})

it('sends a work order whose pickup has already passed', async () => {
  currentFacts.mockResolvedValue(current())
  note.mockResolvedValue(undefined)
  stale.mockClear()
  let sent = 0
  const notice = await deliverStagedWorkOrder(new Headers(), staged(new Date('2020-01-01T00:00:00.000Z')), {
    async sendWorkOrder() {
      sent += 1
    },
  })
  expect(sent).toBe(1)
  expect(notice).toEqual({ driverId, outcome: 'sent' })
  expect(stale).not.toHaveBeenCalled()
})

it('returns stale and sends nothing when a newer work order replaced this one', async () => {
  currentFacts.mockResolvedValue({ ...current(), superseded: true })
  stale.mockResolvedValue(undefined)
  note.mockClear()
  const logs = captureLogs()
  let sent = 0
  const notice = await deliverStagedWorkOrder(new Headers(), staged(new Date('2099-01-01T00:00:00.000Z')), {
    async sendWorkOrder() {
      sent += 1
    },
  }, logs.logger)
  expect(sent).toBe(0)
  expect(notice).toEqual({ driverId, outcome: 'stale' })
  expect(stale).toHaveBeenCalledOnce()
  expect(note).not.toHaveBeenCalled()
  expect(JSON.stringify(logs.lines())).not.toContain(email)
  expect(JSON.stringify(logs.lines())).not.toContain('Ana Tajna')
})
