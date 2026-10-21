import type { TenantTransaction } from '../../../core/index'
import { expect, it } from 'vitest'
import { TenantAccessError } from '../../tenancy'
import { loadClientOfficeBriefs } from './client-office-briefs'

function refusingTransaction(): TenantTransaction {
  return {
    execute() {
      throw new Error('queried')
    },
  } as unknown as TenantTransaction
}

it('refuses a driver before it reads contact persons or the Client note', async () => {
  const error = await loadClientOfficeBriefs(refusingTransaction(), 'driver')
    .then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(TenantAccessError)
  expect(error).toMatchObject({ statusCode: 403 })
})

it('reads live contacts and the note when the actor is office', async () => {
  let calls = 0
  const transaction = {
    execute() {
      calls += 1
      return { rows: [] }
    },
  } as unknown as TenantTransaction
  await expect(loadClientOfficeBriefs(transaction, 'dispatcher')).resolves.toEqual([])
  expect(calls).toBe(3)
})
