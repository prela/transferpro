import type { SQL } from 'drizzle-orm'
import type { JobQueue, TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { ResendTransportError } from '../../tenancy'
import { deliverAssignedWorkOrder, readAssignedWorkOrder, stageWorkOrder } from './work-order'

const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const email = 'ana@example.test'
const guestName = 'Ana Tajna'
const pickupPlace = 'Zračna luka Dubrovnik'
const dropOffPlace = 'Hotel Park'
const tabla = 'TABLA-TAJNA'
const vehiclePlate = 'DU9SECRET'
const price = '77.50'

const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'

const order = {
  rideId,
  driverId,
  vehicleId,
  email,
  locale: 'hr' as const,
  timeZone: 'Europe/Zagreb',
  pickupAt: new Date('2026-10-15T22:30:00.000Z'),
  pickupPlace,
  dropOffPlace,
  guestName,
  tabla,
  passengerCount: 2,
  luggageCount: 1,
  childSeatCount: 0,
  flightNumber: 'OU412',
  clientName: 'Agencija Mora',
  vehicleName: 'Mercedes Vito',
  vehiclePlate,
  note: 'Napomena',
  payment: 'cash' as const,
  price,
}

it('sends one assigned work order and reports sent without the address', async () => {
  const sent: Array<{ to: string, subject: string, text: string }> = []
  const notice = await deliverAssignedWorkOrder(order, {
    async sendWorkOrder(mail) {
      sent.push(mail)
    },
  }, captureLogs().logger)
  expect(notice).toEqual({ driverId, outcome: 'sent' })
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toBe(email)
  expect(sent[0]?.subject).toContain('Dodijeljeno')
  expect(sent[0]?.subject).toContain('16. 10. 2026. 00:30')
  expect(sent[0]?.subject).toContain(pickupPlace)
  expect(sent[0]?.text).toContain(guestName)
  expect(sent[0]?.text).toContain('Cijena: 77,50')
  expect(sent[0]?.text).toContain('Plaćanje: Gotovina')
  expect(JSON.stringify(notice)).not.toContain(email)
})

it('assigns a Driver with no email, sends nothing, and reports no email', async () => {
  let calls = 0
  const notice = await deliverAssignedWorkOrder({ ...order, email: null }, {
    async sendWorkOrder() {
      calls += 1
    },
  }, captureLogs().logger)
  expect(notice).toEqual({ driverId, outcome: 'no_email' })
  expect(calls).toBe(0)
})

it('keeps a blank address as no email and does not send', async () => {
  let calls = 0
  const notice = await deliverAssignedWorkOrder({ ...order, email: '   ' }, {
    async sendWorkOrder() {
      calls += 1
    },
  }, captureLogs().logger)
  expect(notice).toEqual({ driverId, outcome: 'no_email' })
  expect(calls).toBe(0)
})

it('reports send failed once, leaves the caller to keep the Ride, and logs ids only', async () => {
  const logs = captureLogs()
  let calls = 0
  const notice = await deliverAssignedWorkOrder(order, {
    async sendWorkOrder() {
      calls += 1
      throw new Error(`rejected ${email} ${guestName} ${pickupPlace} ${tabla} ${vehiclePlate} ${price}`)
    },
  }, logs.logger)
  expect(notice).toEqual({ driverId, outcome: 'failed' })
  expect(calls).toBe(1)
  const [line] = logs.lines()
  expect(line).toMatchObject({
    event: 'work_order.email_failed',
    rideId,
    driverId,
    err: { type: 'Error' },
  })
  const text = JSON.stringify(line)
  expect(text).not.toContain(email)
  expect(text).not.toContain(guestName)
  expect(text).not.toContain(pickupPlace)
  expect(text).not.toContain(dropOffPlace)
  expect(text).not.toContain(tabla)
  expect(text).not.toContain(vehiclePlate)
  expect(text).not.toContain(price)
  expect(text).not.toContain('77,50')
  expect(text).not.toContain('OU412')
})

it('reads the tenant locale from the row, and a database failure drops the guest', async () => {
  const pickup = new Date('2026-10-15T22:30:00.000Z')
  const clientId = 'a1a1a1a1-1111-4111-8111-111111111111'
  const startLocationId = 'a2a2a2a2-2222-4222-8222-222222222222'
  const endLocationId = 'a3a3a3a3-3333-4333-8333-333333333333'
  const dialect = new PgDialect()
  const transaction = {
    execute: async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql
      if (text.includes('from app.clients'))
        return { rows: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }] }
      if (text.includes('from app.locations')) {
        const id = String(dialect.sqlToQuery(query).params[0])
        const end = id === endLocationId
        return {
          rows: [{
            id,
            name: end ? dropOffPlace : pickupPlace,
            kind: end ? 'hotel' : 'airport',
            address: null,
            iata: end ? null : 'DBV',
            placeProvider: null,
            placeRef: null,
            archivedAt: null,
          }],
        }
      }
      if (text.includes('from app.vehicles')) {
        return {
          rows: [{
            id: vehicleId,
            registrationPlate: vehiclePlate,
            kind: 'fixed',
            registrationExpiresOn: '2030-01-01',
            technicalInspectionExpiresOn: '2030-01-01',
            insuranceExpiresOn: '2030-01-01',
            description: 'Mercedes Vito',
            archivedAt: null,
          }],
        }
      }
      return {
        rows: [{
          driverId,
          email,
          pickupAt: pickup.toISOString(),
          startLocationId,
          endLocationId,
          guestName,
          tabla,
          passengerCount: 2,
          luggageCount: 1,
          childSeatCount: 0,
          flightNumber: 'OU412',
          clientId,
          vehicleId,
          note: 'Napomena',
          payment: 'cash',
          price: '77.5',
          locale: 'en',
          timeZone: 'Europe/Zagreb',
        }],
      }
    },
  } as unknown as TenantTransaction
  const snapshot = await readAssignedWorkOrder(transaction, rideId)
  expect(snapshot.locale).toBe('en')
  expect(snapshot.timeZone).toBe('Europe/Zagreb')
  expect(snapshot.email).toBe(email)
  expect(snapshot.price).toBe('77.50')
  expect(snapshot.pickupAt.toISOString()).toBe(pickup.toISOString())
  expect(snapshot.pickupPlace).toBe('Zračna luka Dubrovnik (DBV)')
  expect(snapshot.dropOffPlace).toBe(dropOffPlace)
  expect(snapshot).not.toHaveProperty('phone')

  const failing = {
    execute: async () => {
      throw new Error(`row contains ${guestName} ${email}`)
    },
  } as unknown as TenantTransaction
  const error = await readAssignedWorkOrder(failing, rideId).catch(caught => caught)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe('Work order read failed')
  expect((error as Error).message).not.toContain(guestName)
  expect((error as Error).message).not.toContain(email)
})

it('sends one idempotency key for the snapshot, and a new one when the words change', async () => {
  const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'
  const keys: Array<string | undefined> = []
  const mailer = {
    async sendWorkOrder(mail: { idempotencyKey?: string }) {
      keys.push(mail.idempotencyKey)
    },
  }
  await deliverAssignedWorkOrder(order, mailer, captureLogs().logger, 'no_longer_yours', entryId)
  await deliverAssignedWorkOrder(order, mailer, captureLogs().logger, 'no_longer_yours', entryId)
  await deliverAssignedWorkOrder({ ...order, guestName: 'Netko Drugi' }, mailer, captureLogs().logger, 'no_longer_yours', entryId)
  expect(keys[0]).toBe(keys[1])
  expect(keys[0]).toContain(entryId)
  expect(keys[2]).not.toBe(keys[0])
  expect(JSON.stringify(keys)).not.toContain(email)
})

it('enqueues the one-minute job on the same transaction as the entry', async () => {
  const dialect = new PgDialect()
  const seen: unknown[][] = []
  const transaction = {
    async execute(query: SQL) {
      seen.push(dialect.sqlToQuery(query).params)
      return { rows: [{ id: 'd1d1d1d1-1111-4111-8111-111111111111' }] }
    },
  } as unknown as TenantTransaction
  const enqueued: Array<{ name: string, data: unknown, startAfter: Date | undefined }> = []
  const now = new Date('2026-10-18T10:00:00.000Z')
  const queue = {
    async enqueue(_context: unknown, same: unknown, name: string, data: unknown, options?: { startAfter?: Date }) {
      expect(same).toBe(transaction)
      enqueued.push({ name, data, startAfter: options?.startAfter })
    },
  } as unknown as JobQueue
  await stageWorkOrder(transaction, order, 'no_longer_yours', {
    queue,
    context: { tenantId: '33333333-3333-4333-8333-333333333333' },
    now,
  })
  expect(enqueued).toEqual([{
    name: 'mail-outbox',
    data: { entryId: 'd1d1d1d1-1111-4111-8111-111111111111' },
    startAfter: new Date('2026-10-18T10:01:00.000Z'),
  }])
  expect(seen[0]).toContain(vehicleId)
  expect(seen[0]?.some(value => value instanceof Date && value.toISOString() === '2026-10-18T10:01:00.000Z')).toBe(true)
})

it('records the released vehicle only on no longer yours', async () => {
  const dialect = new PgDialect()
  const seen: unknown[][] = []
  const transaction = {
    async execute(query: SQL) {
      seen.push(dialect.sqlToQuery(query).params)
      return { rows: [{ id: 'd1d1d1d1-1111-4111-8111-111111111111' }] }
    },
  } as unknown as TenantTransaction
  await stageWorkOrder(transaction, order, 'no_longer_yours')
  await stageWorkOrder(transaction, order, 'assigned')
  expect(seen[0]).toContain(vehicleId)
  expect(seen[1]).not.toContain(vehicleId)
})

it('still aborts when the Resend transport is selected in test', async () => {
  await expect(deliverAssignedWorkOrder(order, {
    async sendWorkOrder() {
      throw new ResendTransportError()
    },
  }, captureLogs().logger)).rejects.toBeInstanceOf(ResendTransportError)
})
