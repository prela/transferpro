import { expect, it } from 'vitest'
import { LOCATION_ADDRESS_MAX_LENGTH, LOCATION_NAME_MAX_LENGTH, locationAddressError, locationIataError, LocationInputError, locationKindError, locationListSchema, locationNameError, parseCreateLocation, parseLocationPatch, parseSuggestAddresses } from './location'

const name = 'Zračna luka Dubrovnik'
const address = 'Dobrota bb, Čilipi'

const createBody = {
  name: `  ${name}  `,
  kind: 'airport' as const,
}

it('accepts a Location, trims the name, and stores a missing address as null', () => {
  expect(parseCreateLocation(createBody)).toEqual({
    name,
    kind: 'airport',
    address: null,
    iata: null,
    place: null,
  })
  expect(parseCreateLocation({ ...createBody, kind: 'hotel' }).kind).toBe('hotel')
  expect(parseCreateLocation({ ...createBody, kind: 'address' }).kind).toBe('address')
  expect(parseCreateLocation({ ...createBody, kind: 'other' }).kind).toBe('other')
})

it('accepts an address line, trims it, and treats blank as null', () => {
  expect(parseCreateLocation({ ...createBody, address: `  ${address}  ` }).address).toBe(address)
  expect(parseCreateLocation({ ...createBody, address: '   ' }).address).toBeNull()
  expect(parseCreateLocation({ ...createBody, address: null }).address).toBeNull()
  expect(() => parseCreateLocation({ ...createBody, address: 'A'.repeat(LOCATION_ADDRESS_MAX_LENGTH + 1) })).toThrow(LocationInputError)
})

it('refuses an empty name, a long name, an unknown kind, and a key that is not a Location field', () => {
  expect(() => parseCreateLocation({ ...createBody, name: '   ' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, name: 'A'.repeat(LOCATION_NAME_MAX_LENGTH + 1) })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, kind: 'stop' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, notes: address })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, archivedAt: '2026-10-05T00:00:00.000Z' })).toThrow(LocationInputError)
  const { name: _name, ...withoutName } = createBody
  expect(() => parseCreateLocation(withoutName)).toThrow(LocationInputError)
})

it('stores an airport code in uppercase and treats a blank as no code', () => {
  expect(parseCreateLocation({ ...createBody, iata: ' dbv ' }).iata).toBe('DBV')
  expect(parseCreateLocation({ ...createBody, iata: 'DBV' }).iata).toBe('DBV')
  expect(parseCreateLocation(createBody).iata).toBeNull()
  expect(parseCreateLocation({ ...createBody, iata: '   ' }).iata).toBeNull()
  expect(parseCreateLocation({ ...createBody, iata: null }).iata).toBeNull()
  expect(parseLocationPatch({ iata: 'dbv' })).toEqual({ iata: 'DBV' })
  expect(parseLocationPatch({ iata: '' })).toEqual({ iata: null })
  expect(parseLocationPatch({ iata: null })).toEqual({ iata: null })
})

it('refuses a code that is not three letters, and a code on a hotel, address, or other Location', () => {
  expect(() => parseCreateLocation({ ...createBody, iata: 'DB' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, iata: 'DBVX' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, iata: 'DB1' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, iata: 'D B' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, iata: 'ßa' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, iata: 'ﬃ' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, kind: 'hotel', iata: 'DBV' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, kind: 'address', iata: 'DBV' })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, kind: 'other', iata: 'DBV' })).toThrow(LocationInputError)
  expect(parseCreateLocation({ ...createBody, kind: 'hotel' }).iata).toBeNull()
  expect(() => parseLocationPatch({ kind: 'hotel', iata: 'DBV' })).toThrow(LocationInputError)
  expect(() => parseLocationPatch({ iata: 'Dubrovnik' })).toThrow(LocationInputError)
  expect(locationIataError('DB')).toBe('invalid')
  expect(locationIataError('   ')).toBeNull()
  expect(locationIataError('dbv')).toBeNull()
})

it('accepts a correction of one field and an empty patch', () => {
  expect(parseLocationPatch({ name: `  ${name}  ` })).toEqual({ name })
  expect(parseLocationPatch({ kind: 'hotel' })).toEqual({ kind: 'hotel' })
  expect(parseLocationPatch({ address: `  ${address}  ` })).toEqual({ address })
  expect(parseLocationPatch({ address: null })).toEqual({ address: null })
  expect(parseLocationPatch({ address: '   ' })).toEqual({ address: null })
  expect(parseLocationPatch({})).toEqual({})
  expect(() => parseLocationPatch({ name: ' ' })).toThrow(LocationInputError)
  expect(() => parseLocationPatch({ kind: 'place' })).toThrow(LocationInputError)
  expect(() => parseLocationPatch({ notes: address })).toThrow(LocationInputError)
  expect(() => parseLocationPatch({ archivedAt: null })).toThrow(LocationInputError)
})

it('names the field the form got wrong, and the error text never carries the address', () => {
  expect(locationNameError('   ')).toBe('empty')
  expect(locationNameError('A'.repeat(LOCATION_NAME_MAX_LENGTH + 1))).toBe('too-long')
  expect(locationNameError(name)).toBeNull()
  expect(locationKindError('')).toBe('invalid')
  expect(locationKindError('airport')).toBeNull()
  expect(locationAddressError('A'.repeat(LOCATION_ADDRESS_MAX_LENGTH + 1))).toBe('too-long')
  expect(locationAddressError(address)).toBeNull()
  expect(locationAddressError('   ')).toBeNull()

  let message = ''
  try {
    parseCreateLocation({ ...createBody, name: ' ', address })
  }
  catch (error) {
    message = error instanceof Error ? `${error.name} ${error.message}` : ''
  }
  expect(message).toBe('LocationInputError Bad request')
  expect(message).not.toContain(address)
  expect(message).not.toContain(name)
})

const place = { provider: 'google' as const, placeRef: 'ChIJvilla' }
const sessionToken = 'a1b2c3d4-5555-4555-8555-555555555555'

it('stores a picked place with the address, and refuses a place that has no address', () => {
  expect(parseCreateLocation({ ...createBody, address, place })).toEqual({
    name,
    kind: 'airport',
    address,
    iata: null,
    place,
  })
  expect(parseCreateLocation({ ...createBody, address, place: null }).place).toBeNull()
  expect(() => parseCreateLocation({ ...createBody, place })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, address: '   ', place })).toThrow(LocationInputError)
  expect(() => parseCreateLocation({ ...createBody, address, place: { provider: 'other', placeRef: 'x' } })).toThrow(LocationInputError)
  expect(() => parseLocationPatch({ address: null, place })).toThrow(LocationInputError)
  expect(parseLocationPatch({ address, place })).toEqual({ address, place })
  expect(parseLocationPatch({ place: null })).toEqual({ place: null })

  let message = ''
  try {
    parseCreateLocation({ ...createBody, place, address })
    parseCreateLocation({ ...createBody, place })
  }
  catch (error) {
    message = error instanceof Error ? error.message : ''
  }
  expect(message).toBe('Bad request')
  expect(message).not.toContain(place.placeRef)
  expect(message).not.toContain(address)
})

it('accepts a suggestion lookup and refuses a short text, a bad token, or an extra key', () => {
  expect(parseSuggestAddresses({ text: `  ${address}  `, sessionToken })).toEqual({
    text: address,
    sessionToken,
  })
  expect(() => parseSuggestAddresses({ text: 'ab', sessionToken })).toThrow(LocationInputError)
  expect(() => parseSuggestAddresses({ text: address, sessionToken: 'not-a-uuid' })).toThrow(LocationInputError)
  expect(() => parseSuggestAddresses({ text: address, sessionToken, region: 'HR' })).toThrow(LocationInputError)
  let message = ''
  try {
    parseSuggestAddresses({ text: address, sessionToken: 'nope' })
  }
  catch (error) {
    message = error instanceof Error ? error.message : ''
  }
  expect(message).not.toContain(address)
})

it('reads a list of Locations, including one that is archived', () => {
  const listed = locationListSchema.parse({
    locations: [{
      id: 'a1b2c3d4-5555-4555-8555-555555555555',
      name,
      kind: 'airport',
      address,
      iata: 'DBV',
      place: null,
      archivedAt: '2026-10-05T10:00:00.000Z',
    }],
  })
  expect(listed.locations[0]?.archivedAt).toBe('2026-10-05T10:00:00.000Z')
})
