import { expect, it } from 'vitest'
import { CLIENT_NAME_MAX_LENGTH, ClientInputError, clientKindError, clientListSchema, clientNameError, parseClientPatch, parseCreateClient } from './client'

const clientId = '9e4b3f6d-5555-4555-8555-555555555555'

it('accepts a trimmed name and a kind, and refuses an empty name, a long name, and an unknown kind', () => {
  expect(parseCreateClient({ name: '  Agencija Mora  ', kind: 'agency' })).toEqual({
    name: 'Agencija Mora',
    kind: 'agency',
  })
  expect(parseCreateClient({ name: 'Hotel Esplanade', kind: 'hotel' }).kind).toBe('hotel')
  expect(parseCreateClient({ name: 'Ana Anić', kind: 'individual' }).kind).toBe('individual')

  expect(() => parseCreateClient({ name: '   ', kind: 'agency' })).toThrow(ClientInputError)
  expect(() => parseCreateClient({ name: '', kind: 'agency' })).toThrow(ClientInputError)
  expect(() => parseCreateClient({ name: 'A'.repeat(CLIENT_NAME_MAX_LENGTH + 1), kind: 'hotel' })).toThrow(ClientInputError)
  expect(() => parseCreateClient({ name: 'Mora', kind: 'partner' })).toThrow(ClientInputError)
  expect(() => parseCreateClient({ name: 'Mora', kind: 'Agency' })).toThrow(ClientInputError)
  expect(() => parseCreateClient({ name: 'Mora' })).toThrow(ClientInputError)
})

it('refuses an unknown key so a name is not joined by an email', () => {
  expect(() => parseCreateClient({ name: 'Mora', kind: 'agency', email: 'ana@example.test' })).toThrow(ClientInputError)
  expect(() => parseClientPatch({ name: 'Mora', email: 'ana@example.test', version: 0 })).toThrow(ClientInputError)
})

it('accepts a correction of one field and a patch with only the version', () => {
  expect(parseClientPatch({ name: '  Mora d.o.o.  ', version: 0 })).toEqual({ name: 'Mora d.o.o.', version: 0 })
  expect(parseClientPatch({ kind: 'hotel', version: 3 })).toEqual({ kind: 'hotel', version: 3 })
  expect(parseClientPatch({ version: 0 })).toEqual({ version: 0 })
  expect(() => parseClientPatch({ name: ' ', version: 0 })).toThrow(ClientInputError)
  expect(() => parseClientPatch({ kind: 'guest', version: 0 })).toThrow(ClientInputError)
})

it('requires the version the form was opened with', () => {
  expect(() => parseClientPatch({ name: 'Mora' })).toThrow(ClientInputError)
  expect(() => parseClientPatch({})).toThrow(ClientInputError)
  expect(() => parseClientPatch({ name: 'Mora', version: 1.5 })).toThrow(ClientInputError)
  expect(() => parseClientPatch({ name: 'Mora', version: -1 })).toThrow(ClientInputError)
  expect(() => parseClientPatch({ name: 'Mora', version: '0' })).toThrow(ClientInputError)
})

it('names the field the form got wrong', () => {
  expect(clientNameError('   ')).toBe('empty')
  expect(clientNameError('')).toBe('empty')
  expect(clientNameError('A'.repeat(CLIENT_NAME_MAX_LENGTH + 1))).toBe('too-long')
  expect(clientNameError(`  ${'A'.repeat(CLIENT_NAME_MAX_LENGTH)}  `)).toBeNull()
  expect(clientKindError('')).toBe('invalid')
  expect(clientKindError('partner')).toBe('invalid')
  expect(clientKindError('individual')).toBeNull()
})

it('lists a Client the Tenant can choose later, with who last changed it', () => {
  const unchanged = { id: clientId, name: 'Agencija Mora', kind: 'agency', version: 0, changedAt: null, changedByName: null }
  const listed = clientListSchema.parse({ clients: [unchanged] })
  expect(listed.clients[0]).toEqual(unchanged)
  const changed = { ...unchanged, version: 2, changedAt: '2026-10-19T09:30:00.000Z', changedByName: 'Dino Dispatcher' }
  expect(clientListSchema.parse({ clients: [changed] }).clients[0]).toEqual(changed)
  expect(clientListSchema.safeParse({
    clients: [{ ...unchanged, kind: 'partner' }],
  }).success).toBe(false)
  expect(clientListSchema.safeParse({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
  }).success).toBe(false)
})
