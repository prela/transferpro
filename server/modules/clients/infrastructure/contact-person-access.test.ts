import { expect, it, vi } from 'vitest'

vi.mock('../../tenancy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tenancy')>()
  return {
    ...actual,
    withTenantFromSession: async (
      _headers: Headers,
      run: (scope: { actor: { role: string, userId: string }, transaction: object }) => Promise<unknown>,
    ) => run({
      actor: { role: 'billing', userId: 'user-1' },
      transaction: {},
    }),
  }
})

const { listContactPersons } = await import('./contact-person-access')
const { TenantAccessError } = await import('../../tenancy')

const clientId = '9e4b3f6d-5555-4555-8555-555555555555'

it('refuses an unknown role before it reads contact persons', async () => {
  const error = await listContactPersons(new Headers(), clientId).then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(TenantAccessError)
  expect(error).toMatchObject({ statusCode: 403 })
})
