import { expect, it, vi } from 'vitest'
import { captureLogs } from '../../../core/testing'

const note = vi.hoisted(() => vi.fn())

vi.mock('../../mail', () => ({
  noteWorkOrderAttempt: note,
  recordWorkOrder: vi.fn(),
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
    run: (scope: { transaction: object }) => Promise<void>,
  ) => {
    await run({ transaction: {} })
  },
}))

const { deliverStagedWorkOrder } = await import('./work-order')

const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const email = 'ana@example.test'

it('returns the office notice when noting the attempt fails, and logs only the entry id', async () => {
  note.mockRejectedValue(new Error(`db ${email} Ana Tajna`))
  const logs = captureLogs()
  const notice = await deliverStagedWorkOrder(new Headers(), {
    entryId,
    status: 'assigned',
    order: {
      rideId: 'e1e1e1e1-2222-4222-8222-222222222222',
      driverId,
      vehicleId: 'c1c1c1c1-1111-4111-8111-111111111111',
      email,
      locale: 'hr',
      timeZone: 'Europe/Zagreb',
      pickupAt: new Date('2026-10-15T22:30:00.000Z'),
      pickupPlace: 'Zračna luka Dubrovnik',
      dropOffPlace: 'Hotel Park',
      guestName: 'Ana Tajna',
      tabla: 'TABLA-TAJNA',
      passengerCount: 2,
      luggageCount: 1,
      childSeatCount: 0,
      flightNumber: 'OU412',
      clientName: 'Agencija Mora',
      vehicleName: 'Mercedes Vito',
      vehiclePlate: 'DU9SECRET',
      note: null,
      payment: 'cash',
      price: '77.50',
    },
  }, {
    async sendWorkOrder() {},
  }, logs.logger)
  expect(notice).toEqual({ driverId, outcome: 'sent' })
  const [line] = logs.lines()
  const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest } = line ?? {}
  expect(rest).toEqual({ event: 'mail_outbox.note_failed', entryId })
  expect(JSON.stringify(line)).not.toContain(email)
  expect(JSON.stringify(line)).not.toContain('Ana Tajna')
})
