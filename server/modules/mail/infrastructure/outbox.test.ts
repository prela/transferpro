import type { TenantTransaction } from '../../../core/index'
import { expect, it } from 'vitest'
import { recordWorkOrder } from './outbox'

const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'

it('writes nothing when the Driver email is blank', async () => {
  const transaction = {
    execute() {
      throw new Error('the outbox must not be written')
    },
  } as unknown as TenantTransaction
  await expect(recordWorkOrder(transaction, {
    rideId,
    driverId,
    status: 'assigned',
    email: null,
  })).resolves.toBeNull()
  await expect(recordWorkOrder(transaction, {
    rideId,
    driverId,
    status: 'cancelled',
    email: '   ',
  })).resolves.toBeNull()
})
