import { expect, it } from 'vitest'
import { ContactPersonInputError, parseContactPersonPatch, parseCreateContactPerson, parseRemoveContactPerson } from './contact-person'

const phone = '+385911110364'
const email = 'booking@example.test'

it('accepts a contact person with a phone, an email, or both, and trims the name', () => {
  expect(parseCreateContactPerson({ name: '  Ana Booking  ', phone })).toEqual({
    name: 'Ana Booking',
    role: null,
    phone,
    email: null,
  })
  expect(parseCreateContactPerson({ name: 'Iva Accounts', email, role: '  accounting  ' })).toEqual({
    name: 'Iva Accounts',
    role: 'accounting',
    phone: null,
    email,
  })
  expect(parseCreateContactPerson({ name: 'Ana Booking', phone, email, role: null })).toEqual({
    name: 'Ana Booking',
    role: null,
    phone,
    email,
  })
})

it('refuses a contact person with neither a phone nor an email, a bad field, or an unknown key', () => {
  expect(() => parseCreateContactPerson({ name: 'Ana Booking' })).toThrow(ContactPersonInputError)
  expect(() => parseCreateContactPerson({ name: 'Ana Booking', phone: '   ', email: '' })).toThrow(ContactPersonInputError)
  expect(() => parseCreateContactPerson({ name: '   ', phone })).toThrow(ContactPersonInputError)
  expect(() => parseCreateContactPerson({ name: 'A'.repeat(201), phone })).toThrow(ContactPersonInputError)
  expect(() => parseCreateContactPerson({ name: 'Ana Booking', phone, role: 'R'.repeat(101) })).toThrow(ContactPersonInputError)
  expect(() => parseCreateContactPerson({ name: 'Ana Booking', phone: '1'.repeat(41) })).toThrow(ContactPersonInputError)
  expect(() => parseCreateContactPerson({ name: 'Ana Booking', email: 'not-an-email' })).toThrow(ContactPersonInputError)
  expect(() => parseCreateContactPerson({ name: 'Ana Booking', phone, note: 'call after 9' })).toThrow(ContactPersonInputError)
})

it('accepts a correction that names the version, and refuses a missing version or an unknown key', () => {
  expect(parseContactPersonPatch({ version: 2, phone })).toEqual({ version: 2, phone })
  expect(parseContactPersonPatch({ version: 0, role: '   ', email: null })).toEqual({ version: 0, role: null, email: null })
  expect(parseContactPersonPatch({ version: 1 })).toEqual({ version: 1 })
  expect(() => parseContactPersonPatch({ phone })).toThrow(ContactPersonInputError)
  expect(() => parseContactPersonPatch({ version: 1, name: 'Ana', primary: true })).toThrow(ContactPersonInputError)
  expect(() => parseContactPersonPatch({ version: -1, phone })).toThrow(ContactPersonInputError)
  expect(parseRemoveContactPerson({ version: 3 })).toEqual({ version: 3 })
  expect(() => parseRemoveContactPerson({ version: 3, name: 'Ana' })).toThrow(ContactPersonInputError)
})
