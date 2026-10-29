import { expect, it } from 'vitest'
import { BILLING_DETAILS_FIELD_LISTS, billingDetailsAreComplete, billingDetailsChangedFields, ClientBillingInputError, EMPTY_BILLING_DETAILS, isValidOib, parseClientBillingSave } from './billing-details'
import { ISO_3166_1_ALPHA_2 } from './iso-country'

/**
 * 12345678903 and 69435151530 are known OIBs: the last digit is the
 * ISO 7064 check of the first ten, worked out apart from this module.
 */

const valid = {
  legalName: 'Hotel Jadran d.o.o.',
  country: 'HR',
  oib: '12345678903',
  vatId: 'HR12345678903',
  address: 'Obala 1, Split',
  guestNameOnInvoice: false,
}

it('accepts the two known OIBs and refuses a wrong check digit, a short number, and letters', () => {
  expect(isValidOib('12345678903')).toBe(true)
  expect(isValidOib('69435151530')).toBe(true)
  expect(isValidOib('12345678901')).toBe(false)
  expect(isValidOib('1234567890')).toBe(false)
  expect(isValidOib('1234567890A')).toBe(false)
})

it('keeps the officially assigned country codes, including Croatia, and not a user-assigned code', () => {
  expect(ISO_3166_1_ALPHA_2).toHaveLength(249)
  expect(ISO_3166_1_ALPHA_2).toContain('HR')
  expect(ISO_3166_1_ALPHA_2).toContain('DE')
  expect(ISO_3166_1_ALPHA_2).not.toContain('XK')
  expect(ISO_3166_1_ALPHA_2).not.toContain('ZZ')
})

it('a Croatian Client is complete only with an OIB, and a foreign Client is complete without one', () => {
  expect(billingDetailsAreComplete({
    legalName: 'Hotel Jadran d.o.o.',
    country: 'HR',
    oib: '12345678903',
    address: 'Obala 1, Split',
  })).toBe(true)
  expect(billingDetailsAreComplete({
    legalName: 'Hotel Jadran d.o.o.',
    country: 'HR',
    oib: null,
    address: 'Obala 1, Split',
  })).toBe(false)
  expect(billingDetailsAreComplete({
    legalName: 'Alpine GmbH',
    country: 'DE',
    oib: null,
    address: 'Hauptstr. 1, München',
  })).toBe(true)
  expect(billingDetailsAreComplete(EMPTY_BILLING_DETAILS)).toBe(false)
})

it('records changed fields in canonical order, and a matching save records none', () => {
  expect(billingDetailsChangedFields(EMPTY_BILLING_DETAILS, {
    legalName: valid.legalName,
    country: 'HR',
    oib: valid.oib,
    vatId: null,
    address: valid.address,
    guestNameOnInvoice: false,
  })).toEqual(['legalName', 'country', 'oib', 'address'])
  expect(billingDetailsChangedFields({
    ...EMPTY_BILLING_DETAILS,
    legalName: valid.legalName,
    country: 'DE',
    address: valid.address,
  }, {
    legalName: valid.legalName,
    country: 'DE',
    oib: null,
    vatId: 'DE123',
    address: 'Neue Str. 2',
    guestNameOnInvoice: true,
  })).toEqual(['vatId', 'address', 'guestNameOnInvoice'])
  const same = {
    legalName: valid.legalName,
    country: 'HR' as const,
    oib: valid.oib,
    vatId: null,
    address: valid.address,
    guestNameOnInvoice: false,
  }
  expect(billingDetailsChangedFields(same, same)).toEqual([])
  expect(BILLING_DETAILS_FIELD_LISTS[0]).toEqual(['legalName'])
  expect(BILLING_DETAILS_FIELD_LISTS.some(list => list.join() === 'country,legalName')).toBe(false)
})

it('trims a Croatian save, uppercases the country, and drops a blank VAT id', () => {
  expect(parseClientBillingSave({
    legalName: `  ${valid.legalName}  `,
    country: 'hr',
    oib: `  ${valid.oib}  `,
    vatId: '   ',
    address: `  ${valid.address}  `,
    guestNameOnInvoice: false,
  })).toEqual({
    legalName: valid.legalName,
    country: 'HR',
    oib: valid.oib,
    vatId: null,
    address: valid.address,
    guestNameOnInvoice: false,
  })
})

it('accepts a foreign Client with no OIB, and a later save keeps the version', () => {
  expect(parseClientBillingSave({
    legalName: 'Alpine GmbH',
    country: 'DE',
    oib: null,
    vatId: 'DE123456789',
    address: 'Hauptstr. 1, München',
    guestNameOnInvoice: true,
    version: 2,
  })).toEqual({
    legalName: 'Alpine GmbH',
    country: 'DE',
    oib: null,
    vatId: 'DE123456789',
    address: 'Hauptstr. 1, München',
    guestNameOnInvoice: true,
    version: 2,
  })
})

it('refuses a Croatian Client without an OIB, a bad OIB, an unknown country, and an unknown key', () => {
  const secret = 'Tajni naziv koji ne smije u poruku'
  expect(() => parseClientBillingSave({ ...valid, oib: null })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, oib: '12345678901' })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, country: 'ZZ' })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, country: 'XK' })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, legalName: '' })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, legalName: 'A'.repeat(201) })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, address: 'A'.repeat(301) })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, vatId: 'A'.repeat(21) })).toThrow(ClientBillingInputError)
  expect(() => parseClientBillingSave({ ...valid, version: -1 })).toThrow(ClientBillingInputError)
  try {
    parseClientBillingSave({ ...valid, note: secret })
    expect.unreachable()
  }
  catch (error) {
    expect(error).toBeInstanceOf(ClientBillingInputError)
    expect((error as Error).message).not.toContain(secret)
  }
})
