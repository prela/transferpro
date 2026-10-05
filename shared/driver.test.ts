import { expect, it } from 'vitest'
import { DRIVER_NAME_MAX_LENGTH, DRIVER_PHONE_MAX_LENGTH, driverDateError, DriverInputError, driverKindError, driverListSchema, driverNameError, driverPhoneError, parseCreateDriver, parseDriverPatch } from './driver'

const phone = '+385 91 111 2222'

const createBody = {
  name: '  Marko Marić  ',
  kind: 'own' as const,
  phone: `  ${phone}  `,
  drivingLicenceExpiresOn: '2027-06-01',
  transportLicenceExpiresOn: '2028-01-31',
}

it('accepts a Driver without an account, and trims the name and the phone', () => {
  expect(parseCreateDriver(createBody)).toEqual({
    name: 'Marko Marić',
    kind: 'own',
    phone,
    drivingLicenceExpiresOn: '2027-06-01',
    transportLicenceExpiresOn: '2028-01-31',
  })
  expect(parseCreateDriver({ ...createBody, kind: 'external', memberUserId: null }).kind).toBe('external')
})

it('accepts a leap day and refuses a day that is not on the calendar', () => {
  expect(parseCreateDriver({ ...createBody, drivingLicenceExpiresOn: '2024-02-29' }).drivingLicenceExpiresOn).toBe('2024-02-29')
  expect(() => parseCreateDriver({ ...createBody, drivingLicenceExpiresOn: '2025-02-29' })).toThrow(DriverInputError)
  expect(() => parseCreateDriver({ ...createBody, transportLicenceExpiresOn: '2026-02-31' })).toThrow(DriverInputError)
  expect(() => parseCreateDriver({ ...createBody, drivingLicenceExpiresOn: '01.06.2027' })).toThrow(DriverInputError)
  expect(() => parseCreateDriver({ ...createBody, drivingLicenceExpiresOn: '2027-06-01T00:00:00Z' })).toThrow(DriverInputError)
})

it('refuses an empty name, a long phone, an unknown kind, and a key that is not a Driver field', () => {
  expect(() => parseCreateDriver({ ...createBody, name: '   ' })).toThrow(DriverInputError)
  expect(() => parseCreateDriver({ ...createBody, phone: '1'.repeat(DRIVER_PHONE_MAX_LENGTH + 1) })).toThrow(DriverInputError)
  expect(() => parseCreateDriver({ ...createBody, name: 'A'.repeat(DRIVER_NAME_MAX_LENGTH + 1) })).toThrow(DriverInputError)
  expect(() => parseCreateDriver({ ...createBody, kind: 'partner' })).toThrow(DriverInputError)
  expect(() => parseCreateDriver({ ...createBody, email: 'marko@example.test' })).toThrow(DriverInputError)
  // Must-accept starts off. The create body cannot turn it on.
  expect(() => parseCreateDriver({ ...createBody, mustAccept: true })).toThrow(DriverInputError)
  const { phone: _phone, ...withoutPhone } = createBody
  expect(() => parseCreateDriver(withoutPhone)).toThrow(DriverInputError)
})

it('keeps an optional member id and refuses a blank one', () => {
  const memberUserId = '6b1e0c3a-2222-4222-8222-222222222222'
  expect(parseCreateDriver({ ...createBody, memberUserId: `  ${memberUserId}  ` }).memberUserId).toBe(memberUserId)
  expect(() => parseCreateDriver({ ...createBody, memberUserId: '   ' })).toThrow(DriverInputError)
})

it('accepts a correction of one field, a cleared member, and an empty patch', () => {
  expect(parseDriverPatch({ phone: `  ${phone}  ` })).toEqual({ phone })
  expect(parseDriverPatch({ kind: 'external' })).toEqual({ kind: 'external' })
  expect(parseDriverPatch({ memberUserId: null })).toEqual({ memberUserId: null })
  expect(parseDriverPatch({ mustAccept: true })).toEqual({ mustAccept: true })
  expect(parseDriverPatch({})).toEqual({})
  expect(() => parseDriverPatch({ phone: ' ' })).toThrow(DriverInputError)
  expect(() => parseDriverPatch({ drivingLicenceExpiresOn: '2026-13-01' })).toThrow(DriverInputError)
  expect(() => parseDriverPatch({ phone, notes: 'call after 18' })).toThrow(DriverInputError)
})

it('names the field the form got wrong, and the error text never carries the phone', () => {
  expect(driverNameError('   ')).toBe('empty')
  expect(driverNameError('A'.repeat(DRIVER_NAME_MAX_LENGTH + 1))).toBe('too-long')
  expect(driverNameError('Marko')).toBeNull()
  expect(driverPhoneError('  ')).toBe('empty')
  expect(driverPhoneError('1'.repeat(DRIVER_PHONE_MAX_LENGTH + 1))).toBe('too-long')
  expect(driverPhoneError(phone)).toBeNull()
  expect(driverKindError('')).toBe('invalid')
  expect(driverKindError('own')).toBeNull()
  expect(driverDateError('')).toBe('invalid')
  expect(driverDateError('2027-06-01')).toBeNull()

  let message = ''
  try {
    parseCreateDriver({ ...createBody, phone: ' ' })
  }
  catch (error) {
    message = error instanceof Error ? `${error.name} ${error.message}` : ''
  }
  expect(message).toBe('DriverInputError Bad request')
  expect(message).not.toContain(phone)
})

it('lists a Driver the office can correct later', () => {
  const listed = driverListSchema.parse({
    drivers: [{
      id: '9e4b3f6d-5555-4555-8555-555555555555',
      name: 'Marko Marić',
      kind: 'own',
      phone,
      drivingLicenceExpiresOn: '2027-06-01',
      transportLicenceExpiresOn: '2028-01-31',
      memberUserId: null,
      mustAccept: false,
    }],
  })
  expect(listed.drivers[0]?.memberUserId).toBeNull()
  expect(driverListSchema.safeParse({
    drivers: [{ ...listed.drivers[0], kind: 'agency' }],
  }).success).toBe(false)
})
