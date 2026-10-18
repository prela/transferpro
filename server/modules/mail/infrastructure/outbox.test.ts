import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it } from 'vitest'
import { recordWorkOrder } from './outbox'

const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'

it('writes nothing when the Driver email is blank', async () => {
  const transaction = {
    execute() {
      throw new Error('the outbox must not be written')
    },
  } as unknown as TenantTransaction
  await expect(recordWorkOrder(transaction, {
    rideId,
    driverId,
    vehicleId,
    status: 'assigned',
    email: null,
  })).resolves.toBeNull()
  await expect(recordWorkOrder(transaction, {
    rideId,
    driverId,
    vehicleId: null,
    status: 'cancelled',
    email: '   ',
  })).resolves.toBeNull()
})

it('stores the released vehicle id and no plate', async () => {
  const dialect = new PgDialect()
  let seen: { sql: string, params: unknown[] } | undefined
  const transaction = {
    async execute(query: SQL) {
      seen = dialect.sqlToQuery(query)
      return { rows: [{ id: entryId }] }
    },
  } as unknown as TenantTransaction
  await expect(recordWorkOrder(transaction, {
    rideId,
    driverId,
    vehicleId,
    status: 'no_longer_yours',
    email: 'ana@example.test',
  })).resolves.toBe(entryId)
  expect(seen?.sql).toContain('vehicle_id')
  expect(seen?.params).toContain(vehicleId)
  expect(seen?.sql).not.toContain('registration_plate')
  expect(JSON.stringify(seen?.params)).not.toContain('DU')
})
