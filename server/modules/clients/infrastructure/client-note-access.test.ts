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

const { readClientNote, writeClientNote } = await import('./client-note-access')
const { TenantAccessError } = await import('../../tenancy')
const { ClientNoteInputError } = await import('../../../../shared')

const clientId = '9e4b3f6d-5555-4555-8555-555555555555'

it('refuses an unknown role before it reads the Client note', async () => {
  const error = await readClientNote(new Headers(), clientId).then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(TenantAccessError)
  expect(error).toMatchObject({ statusCode: 403 })
})

it('refuses a bad note before a session opens, and an unknown role before it writes', async () => {
  const bad = await writeClientNote(new Headers(), clientId, { note: 'A'.repeat(2001) }).then(() => undefined, (caught: unknown) => caught)
  expect(bad).toBeInstanceOf(ClientNoteInputError)
  const refused = await writeClientNote(new Headers(), clientId, { note: 'Gosti se čekaju na izlazu.' }).then(() => undefined, (caught: unknown) => caught)
  expect(refused).toBeInstanceOf(TenantAccessError)
  expect(refused).toMatchObject({ statusCode: 403 })
})
