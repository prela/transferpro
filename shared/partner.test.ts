import { expect, it } from 'vitest'
import { DRIVER_EMAIL_MAX_LENGTH, DRIVER_PHONE_MAX_LENGTH } from './driver'
import { parseCreatePartner, parsePartnerPatch, PARTNER_NAME_MAX_LENGTH, PARTNER_NOTE_MAX_LENGTH, partnerChangedFields, partnerCreatedFields, PartnerInputError } from './partner'

const name = 'Mora Transfer'

it('trims a Partner and keeps a blank phone, email, and note off the row', () => {
  expect(parseCreatePartner({
    name: `  ${name}  `,
    phone: '   ',
    email: '',
    note: '  ',
  })).toEqual({
    name,
    phone: null,
    email: null,
    note: null,
  })
  expect(partnerCreatedFields(parseCreatePartner({ name }))).toEqual(['name'])
})

it('keeps a phone, an email, and a note, and records those field names', () => {
  const created = parseCreatePartner({
    name,
    phone: '  +385 91 111 2222  ',
    email: '  office@mora.example  ',
    note: '  Call the desk.  ',
  })
  expect(created).toEqual({
    name,
    phone: '+385 91 111 2222',
    email: 'office@mora.example',
    note: 'Call the desk.',
  })
  expect(partnerCreatedFields(created)).toEqual(['name', 'phone', 'email', 'note'])
})

it('refuses an empty name, a long name, a bad phone, a bad email, a long note, and an unknown key', () => {
  expect(() => parseCreatePartner({ name: '   ' })).toThrow(PartnerInputError)
  expect(() => parseCreatePartner({ name: 'A'.repeat(PARTNER_NAME_MAX_LENGTH + 1) })).toThrow(PartnerInputError)
  expect(() => parseCreatePartner({ name, phone: '1'.repeat(DRIVER_PHONE_MAX_LENGTH + 1) })).toThrow(PartnerInputError)
  expect(() => parseCreatePartner({ name, email: 'not-an-email' })).toThrow(PartnerInputError)
  expect(() => parseCreatePartner({ name, email: `${'a'.repeat(DRIVER_EMAIL_MAX_LENGTH)}@x` })).toThrow(PartnerInputError)
  expect(() => parseCreatePartner({ name, note: 'n'.repeat(PARTNER_NOTE_MAX_LENGTH + 1) })).toThrow(PartnerInputError)
  expect(() => parseCreatePartner({ name, archivedAt: null })).toThrow(PartnerInputError)
  expect(() => parseCreatePartner({ name, kind: 'agency' })).toThrow(PartnerInputError)
})

it('corrects only the fields in the body and can clear a contact', () => {
  expect(parsePartnerPatch({ phone: '  +385911110000  ' })).toEqual({ phone: '+385911110000' })
  expect(parsePartnerPatch({ email: '  ', note: null })).toEqual({ email: null, note: null })
  expect(parsePartnerPatch({})).toEqual({})
  expect(() => parsePartnerPatch({ name: '  ' })).toThrow(PartnerInputError)
  expect(() => parsePartnerPatch({ archivedAt: '2026-10-20T00:00:00.000Z' })).toThrow(PartnerInputError)
})

it('names a changed field only when the stored value differs', () => {
  const current = { name, phone: '+385911110000', email: null, note: 'Call the desk.' }
  expect(partnerChangedFields(current, { ...current, name: 'Jug' })).toEqual(['name'])
  expect(partnerChangedFields(current, { ...current, phone: null, email: 'office@mora.example' })).toEqual(['phone', 'email'])
  expect(partnerChangedFields(current, current)).toEqual([])
})
