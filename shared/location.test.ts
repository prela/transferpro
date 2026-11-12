import { expect, it } from 'vitest'
import { fillLocationFromPick, LOCATION_ADDRESS_MAX_LENGTH, LOCATION_KINDS, LOCATION_NAME_MAX_LENGTH, locationAddressError, locationIataError, LocationInputError, locationKindError, locationLabel, locationListSchema, locationNameError, locationNameMaySuggest, locationPanelEmbedUrl, parseCreateLocation, parseLocationPatch, parseSuggestAddresses } from './location'

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

it('shows an airport code beside the name, and a Location with no code by name alone', () => {
  expect(locationLabel({ name, iata: 'DBV' })).toBe('Zračna luka Dubrovnik (DBV)')
  expect(locationLabel({ name, iata: null })).toBe(name)
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

it('shows the saved Embed URL only while the address field is untouched', () => {
  // A null URL is what a typed Location, an archived Location, and Embed
  // switched off already produce. The panel then has no button.
  const embedUrl = 'about:blank#placeRef=ChIJfakeDubrovnik&language=hr'
  expect(locationPanelEmbedUrl(embedUrl, true)).toBe(embedUrl)
  expect(locationPanelEmbedUrl(null, true)).toBeNull()
  expect(locationPanelEmbedUrl(embedUrl, false)).toBeNull()
  expect(locationPanelEmbedUrl(null, false)).toBeNull()
})

const establishment = {
  name: 'Hotel Primjer',
  address: 'Ulica Primjera 1',
  establishment: true,
  provider: 'google' as const,
  placeRef: 'ChIJhotel',
}

const street = {
  name: 'Ulica 1·',
  address: 'Ulica 1, Dubrovnik',
  establishment: false,
  provider: 'google' as const,
  placeRef: 'ChIJstreet',
}

it('fills the name and the address from a name pick, replacing either address', () => {
  const typed = 'Obala 3'
  const picked = 'Stara 2, Grad'
  const fromTyped = fillLocationFromPick('name', establishment, { name: 'Hotel Ex', address: typed })
  const fromPicked = fillLocationFromPick('name', establishment, { name: 'Hotel Ex', address: picked })
  expect(fromTyped).toEqual({
    name: 'Hotel Primjer',
    address: 'Ulica Primjera 1',
    place: { provider: 'google', placeRef: 'ChIJhotel' },
  })
  expect(fromPicked).toEqual(fromTyped)
  expect(fromTyped.address).not.toBe(typed)
  expect(fromPicked.address).not.toBe(picked)
})

it('fills an empty name from an establishment on the address, and keeps a typed name', () => {
  const filled = fillLocationFromPick('address', establishment, { name: '', address: 'nista' })
  expect(filled.name).toBe('Hotel Primjer')
  expect(filled.address).toBe('Ulica Primjera 1')
  expect(filled.place).toEqual({ provider: 'google', placeRef: 'ChIJhotel' })
  const blank = fillLocationFromPick('address', establishment, { name: '   ', address: '' })
  expect(blank.name).toBe('Hotel Primjer')
  const kept = fillLocationFromPick('address', establishment, { name: 'Vila Test', address: 'nista' })
  expect(kept.name).toBe('Vila Test')
  expect(kept.address).toBe('Ulica Primjera 1')
})

it('leaves the name alone when a street address is picked', () => {
  const empty = fillLocationFromPick('address', street, { name: '', address: '' })
  expect(empty.name).toBe('')
  expect(empty.address).toBe('Ulica 1, Dubrovnik')
  expect(empty.place.placeRef).toBe('ChIJstreet')
  const named = fillLocationFromPick('address', street, { name: '   ', address: 'staro' })
  expect(named.name).toBe('   ')
})

it('suggests from the name only for an airport, a hotel, or other', () => {
  expect(locationNameMaySuggest('airport')).toBe(true)
  expect(locationNameMaySuggest('hotel')).toBe(true)
  expect(locationNameMaySuggest('other')).toBe(true)
  expect(locationNameMaySuggest('address')).toBe(false)
  expect(locationNameMaySuggest(undefined)).toBe(false)
  expect(LOCATION_KINDS.filter(kind => locationNameMaySuggest(kind))).toEqual(['airport', 'hotel', 'other'])
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
