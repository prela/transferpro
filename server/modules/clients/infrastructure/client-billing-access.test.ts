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
    withOfficeWrite: async (
      _headers: Headers,
      raw: unknown,
      parse: (body: unknown) => unknown,
      run: (scope: { actor: { role: string, userId: string }, transaction: object }, input: unknown) => Promise<unknown>,
    ) => run({
      actor: { role: 'billing', userId: 'user-1' },
      transaction: {},
    }, parse(raw)),
  }
})

const { readClientBilling, writeClientBilling } = await import('./client-billing-access')
const { TenantAccessError } = await import('../../tenancy')
const { ClientBillingInputError } = await import('../../../../shared')

const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const body = {
  legalName: 'Hotel Jadran d.o.o.',
  country: 'HR',
  oib: '12345678903',
  vatId: null,
  address: 'Obala 1, Split',
  guestNameOnInvoice: false,
}

it('refuses an unknown role before it reads billing details', async () => {
  const error = await readClientBilling(new Headers(), clientId).then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(TenantAccessError)
  expect(error).toMatchObject({ statusCode: 403 })
})

it('refuses a bad body before a session opens, and an unknown role before it writes', async () => {
  const bad = await writeClientBilling(new Headers(), clientId, { ...body, oib: null }).then(() => undefined, (caught: unknown) => caught)
  expect(bad).toBeInstanceOf(ClientBillingInputError)
  const refused = await writeClientBilling(new Headers(), clientId, body).then(() => undefined, (caught: unknown) => caught)
  expect(refused).toBeInstanceOf(TenantAccessError)
  expect(refused).toMatchObject({ statusCode: 403 })
})
