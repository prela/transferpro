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
  expect(() => parseClientPatch({ name: 'Mora', email: 'ana@example.test' })).toThrow(ClientInputError)
})

it('accepts a correction of one field and an empty patch', () => {
  expect(parseClientPatch({ name: '  Mora d.o.o.  ' })).toEqual({ name: 'Mora d.o.o.' })
  expect(parseClientPatch({ kind: 'hotel' })).toEqual({ kind: 'hotel' })
  expect(parseClientPatch({})).toEqual({})
  expect(() => parseClientPatch({ name: ' ' })).toThrow(ClientInputError)
  expect(() => parseClientPatch({ kind: 'guest' })).toThrow(ClientInputError)
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

it('lists a Client the Tenant can choose later', () => {
  const listed = clientListSchema.parse({
    clients: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }],
  })
  expect(listed.clients[0]).toEqual({ id: clientId, name: 'Agencija Mora', kind: 'agency' })
  expect(clientListSchema.safeParse({
    clients: [{ id: clientId, name: 'Mora', kind: 'partner' }],
  }).success).toBe(false)
})
