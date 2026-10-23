import { expect, it } from 'vitest'
import { QueryParamError } from './query'
import { canAddExtraVehicle, canCancelRide, canCorrectTransfer, canDeclineRide, canMarkRideDone, canRecordLandingTime, changedTransferFields, CHILD_SEAT_COUNT_MAX, CLIENT_REFERENCE_MAX_LENGTH, correctionReturnsAcceptedRide, FLIGHT_NUMBER_MAX_LENGTH, GROUP_PASSENGER_COUNT_MAX, GUEST_NAME_MAX_LENGTH, LUGGAGE_COUNT_MAX, NOTE_MAX_LENGTH, officeGroupPassengerCount, parseCorrectTransfer, parseCreateTransfer, parseRecordTransfer, parseTransferDay, PASSENGER_COUNT_MAX, pickupAtError, priceError, sameLocationError, TransferInputError } from './transfer'

const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const startLocationId = 'a1b2c3d4-5555-4555-8555-555555555555'
const endLocationId = 'b1b2c3d4-6666-4666-8666-666666666666'
const guest = 'Ana Anić'
const flight = 'OU 384'
const note = 'Čeka na terminalu'

const now = new Date('2026-10-06T12:00:00.000Z')
const externalId = 'c3c3c3c3-3333-4333-8333-333333333333'
const mainTransferId = 'd4d4d4d4-4444-4444-8444-444444444444'

const body = {
  clientId,
  pickupAt: '2026-10-06T22:30:00.000Z',
  startLocationId,
  endLocationId,
  passengerCount: 2,
  guestName: `  ${guest}  `,
  price: 42.5,
  payment: 'cash' as const,
  airportMark: false,
  luggageCount: 1,
  childSeatCount: 0,
}

/** A create body. Corrections stay on `body`, which has no entry key. */
function withEntryKey(value: Record<string, unknown>) {
  return { externalId, ...value }
}

it('accepts a Transfer, trims the guest name, and stores a blank flight and note as null', () => {
  expect(parseCreateTransfer(withEntryKey(body), now)).toEqual({
    clientId,
    pickupAt: '2026-10-06T22:30:00.000Z',
    startLocationId,
    endLocationId,
    passengerCount: 2,
    guestName: guest,
    flightNumber: null,
    price: '42.50',
    payment: 'cash',
    airportMark: false,
    luggageCount: 1,
    childSeatCount: 0,
    note: null,
    tabla: '',
    clientReference: null,
  })
})

it('stores a Client reference trimmed, and a blank one as null', () => {
  expect(parseCreateTransfer(withEntryKey({ ...body, clientReference: '  V-19  ' }), now).clientReference).toBe('V-19')
  expect(parseCreateTransfer(withEntryKey({ ...body, clientReference: '   ' }), now).clientReference).toBeNull()
  expect(parseCreateTransfer(withEntryKey({ ...body, clientReference: null }), now).clientReference).toBeNull()
  expect(parseCorrectTransfer({ ...body, clientReference: '  V-20  ', confirm: true, version: 0 }, now).input.clientReference).toBe('V-20')
  expect(() => parseCreateTransfer(withEntryKey({
    ...body,
    clientReference: 'A'.repeat(CLIENT_REFERENCE_MAX_LENGTH + 1),
  }), now)).toThrow(TransferInputError)
})

it('accepts confirm on a correction and refuses it on a new Transfer', () => {
  expect(parseCorrectTransfer({ ...body, confirm: true, version: 2 }, now)).toMatchObject({
    confirm: true,
    version: 2,
    input: { guestName: guest, pickupAt: '2026-10-06T22:30:00.000Z' },
  })
  expect(parseCorrectTransfer({ ...body, version: 0 }, now).confirm).toBe(false)
  expect(() => parseCorrectTransfer({ ...body, confirm: 'yes', version: 0 }, now)).toThrow(TransferInputError)
  expect(() => parseCorrectTransfer({ ...body, confirm: true, version: 0, plate: 'ZG1' }, now)).toThrow(TransferInputError)
  expect(() => parseCorrectTransfer(body, now)).toThrow(TransferInputError)
  expect(() => parseCorrectTransfer({ ...body, version: -1 }, now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, confirm: true }), now)).toThrow(TransferInputError)
})

it('accepts an extra vehicle at price 0 and refuses a group count on an ordinary create', () => {
  expect(parseRecordTransfer(withEntryKey({
    ...body,
    price: 0,
    mainTransferId,
    groupPassengerCount: GROUP_PASSENGER_COUNT_MAX,
    mainVersion: 0,
  }), now)).toMatchObject({
    mainTransferId,
    groupPassengerCount: GROUP_PASSENGER_COUNT_MAX,
    mainVersion: 0,
    input: { price: '0.00' },
  })
  expect(parseRecordTransfer(withEntryKey(body), now)).toMatchObject({
    mainTransferId: null,
    groupPassengerCount: null,
    mainVersion: null,
  })
  expect(() => parseRecordTransfer(withEntryKey({ ...body, price: 0, mainTransferId: 'not-a-uuid' }), now)).toThrow(TransferInputError)
  expect(() => parseRecordTransfer(withEntryKey({ ...body, mainTransferId }), now)).toThrow(TransferInputError)
  expect(() => parseRecordTransfer(withEntryKey({ ...body, groupPassengerCount: 80 }), now)).toThrow(TransferInputError)
  expect(() => parseRecordTransfer(withEntryKey({ ...body, mainVersion: 0 }), now)).toThrow(TransferInputError)
  expect(() => parseRecordTransfer(withEntryKey({
    ...body,
    price: 0,
    mainTransferId,
    groupPassengerCount: GROUP_PASSENGER_COUNT_MAX + 1,
  }), now)).toThrow(TransferInputError)
  expect(parseCorrectTransfer({ ...body, version: 1, groupPassengerCount: 80 }, now).groupPassengerCount).toBe(80)
  expect(parseCorrectTransfer({ ...body, version: 1 }, now).groupPassengerCount).toBeNull()
  expect(() => parseCorrectTransfer({ ...body, version: 0, mainTransferId }, now)).toThrow(TransferInputError)
  expect(() => parseCorrectTransfer({ ...body, version: 0, groupPassengerCount: 0 }, now)).toThrow(TransferInputError)
  expect(() => parseCorrectTransfer({ ...body, version: 0, groupPassengerCount: null }, now)).toThrow(TransferInputError)
})

it('offers an extra vehicle only while the main Transfer is still correctable', () => {
  expect(canAddExtraVehicle({ state: 'unassigned', mainTransferId: null, linkedMain: null })).toBe(true)
  expect(canAddExtraVehicle({ state: 'handed_off', mainTransferId: null, linkedMain: null })).toBe(true)
  expect(canAddExtraVehicle({ state: 'done', mainTransferId: null, linkedMain: null })).toBe(false)
  expect(canAddExtraVehicle({ state: 'cancelled', mainTransferId: null, linkedMain: null })).toBe(false)
  // The extra vehicle's own state does not decide. A finished extra still
  // adds to a main Transfer that is open. A closed main does not.
  expect(canAddExtraVehicle({
    state: 'done',
    mainTransferId,
    linkedMain: { state: 'assigned' },
  })).toBe(true)
  expect(canAddExtraVehicle({
    state: 'unassigned',
    mainTransferId,
    linkedMain: { state: 'cancelled' },
  })).toBe(false)
  expect(canAddExtraVehicle({ state: 'unassigned', mainTransferId, linkedMain: null })).toBe(false)
})

it('reads the stored group count for a main Transfer and none for an extra vehicle', () => {
  expect(officeGroupPassengerCount(null, null, 2)).toBe(2)
  expect(officeGroupPassengerCount(null, 80, 2)).toBe(80)
  expect(officeGroupPassengerCount(mainTransferId, null, 2)).toBeNull()
})

it('requires an external id on a new Transfer and refuses it on a correction', () => {
  expect(() => parseRecordTransfer(body, now)).toThrow(TransferInputError)
  expect(parseRecordTransfer(withEntryKey(body), now)).toMatchObject({
    externalId,
    input: { guestName: guest },
  })
  expect(parseCreateTransfer(withEntryKey(body), now).guestName).toBe(guest)
  expect(() => parseRecordTransfer(withEntryKey({ ...body, externalId: 'not-a-uuid' }), now)).toThrow(TransferInputError)
  expect(() => parseCorrectTransfer({ ...body, version: 0, externalId }, now)).toThrow(TransferInputError)
  expect(() => parseCorrectTransfer({ ...body, version: 0, channel: 'manual' }, now)).toThrow(TransferInputError)
})

it('stores a blank tabla as empty text and trims a meet sign of at most 200 characters', () => {
  expect(parseCreateTransfer(withEntryKey(body), now).tabla).toBe('')
  expect(parseCreateTransfer(withEntryKey({ ...body, tabla: '   ' }), now).tabla).toBe('')
  expect(parseCreateTransfer(withEntryKey({ ...body, tabla: null }), now).tabla).toBe('')
  const parsed = parseCreateTransfer(withEntryKey({
    ...body,
    guestName: `  ${guest}  `,
    note,
    tabla: '  GOSPOĐA HORVAT  ',
  }), now)
  expect(parsed.tabla).toBe('GOSPOĐA HORVAT')
  expect(parsed.guestName).toBe(guest)
  expect(parsed.note).toBe(note)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, tabla: 'A'.repeat(201) }), now)).toThrow(TransferInputError)
})

it('keeps a flight number without turning it into an airport pickup', () => {
  const parsed = parseCreateTransfer(withEntryKey({
    ...body,
    flightNumber: `  ${flight}  `,
    airportMark: false,
    payment: 'invoice_to_agency',
    price: 0,
    note: `  ${note}  `,
  }), now)
  expect(parsed.flightNumber).toBe(flight)
  expect(parsed.airportMark).toBe(false)
  expect(parsed.payment).toBe('invoice_to_agency')
  expect(parsed.price).toBe('0.00')
  expect(parsed.note).toBe(note)
})

it('refuses a bad fare, a long guest name, an extra key, and a missing airport mark', () => {
  expect(() => parseCreateTransfer(withEntryKey({ ...body, price: -1 }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, price: 100_000_000 }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, price: 1.001 }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, guestName: '   ' }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, guestName: 'A'.repeat(GUEST_NAME_MAX_LENGTH + 1) }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, flightNumber: 'A'.repeat(FLIGHT_NUMBER_MAX_LENGTH + 1) }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, note: 'A'.repeat(NOTE_MAX_LENGTH + 1) }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, passengerCount: 0 }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, passengerCount: PASSENGER_COUNT_MAX + 1 }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, luggageCount: LUGGAGE_COUNT_MAX + 1 }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, childSeatCount: CHILD_SEAT_COUNT_MAX + 1 }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, payment: 'invoice' }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, airportMark: 'true' }), now)).toThrow(TransferInputError)
  const { airportMark: _mark, ...withoutMark } = body
  expect(() => parseCreateTransfer(withEntryKey(withoutMark), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, address: 'Dobrota' }), now)).toThrow(TransferInputError)
})

it('accepts a pickup on the 30-day and 18-month edges and refuses one millisecond outside', () => {
  const earliest = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const latest = new Date('2028-04-06T12:00:00.000Z')
  expect(pickupAtError(earliest.toISOString(), now)).toBeNull()
  expect(pickupAtError(new Date(earliest.getTime() - 1).toISOString(), now)).toBe('too-early')
  expect(pickupAtError(latest.toISOString(), now)).toBeNull()
  expect(pickupAtError(new Date(latest.getTime() + 1).toISOString(), now)).toBe('too-late')
  expect(parseCreateTransfer(withEntryKey({ ...body, pickupAt: earliest.toISOString() }), now).pickupAt).toBe(earliest.toISOString())
  expect(parseCreateTransfer(withEntryKey({ ...body, pickupAt: latest.toISOString() }), now).pickupAt).toBe(latest.toISOString())
  expect(() => parseCreateTransfer(withEntryKey({ ...body, pickupAt: new Date(earliest.getTime() - 1).toISOString() }), now)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer(withEntryKey({ ...body, pickupAt: new Date(latest.getTime() + 1).toISOString() }), now)).toThrow(TransferInputError)
})

it('treats an unparseable pickup as invalid, not too-early', () => {
  expect(pickupAtError('not-a-date', now)).toBe('invalid')
  expect(pickupAtError('', now)).toBe('invalid')
  expect(pickupAtError('2026-10-06T22:30:00.000Z', new Date('not-a-date'))).toBe('invalid')
})

it('refuses a Transfer whose start and end are the same place', () => {
  expect(sameLocationError(startLocationId, endLocationId)).toBeNull()
  expect(sameLocationError(startLocationId, startLocationId)).toBe('same')
  expect(() => parseCreateTransfer(withEntryKey({ ...body, endLocationId: startLocationId }), now)).toThrow(TransferInputError)
})

it('leaves a missing day for the operational-day default and refuses a day that is not a calendar date', () => {
  expect(parseTransferDay(undefined)).toBeNull()
  expect(parseTransferDay('2026-10-07')).toBe('2026-10-07')
  expect(() => parseTransferDay('')).toThrow(QueryParamError)
  expect(() => parseTransferDay('2026-02-31')).toThrow(QueryParamError)
  expect(() => parseTransferDay('06.10.2026')).toThrow(QueryParamError)
})

it('accepts a comma as a decimal mark and refuses a third digit', () => {
  expect(priceError('12,5')).toBeNull()
  expect(priceError('0')).toBeNull()
  expect(priceError('')).toBe('invalid')
  expect(priceError('-1')).toBe('invalid')
  expect(priceError('1.001')).toBe('invalid')
})

it('allows a cancel from unassigned, assigned, and accepted, and from no terminal state', () => {
  expect(canCancelRide('unassigned')).toBe(true)
  expect(canCancelRide('assigned')).toBe(true)
  expect(canCancelRide('accepted')).toBe(true)
  expect(canCancelRide('handed_off')).toBe(true)
  expect(canCancelRide('done')).toBe(false)
  expect(canCancelRide('no-show')).toBe(false)
  expect(canCancelRide('cancelled')).toBe(false)
})

it('allows a landing time on an unfinished Ride, including one with no Driver', () => {
  expect(canRecordLandingTime('unassigned')).toBe(true)
  expect(canRecordLandingTime('assigned')).toBe(true)
  expect(canRecordLandingTime('accepted')).toBe(true)
  expect(canRecordLandingTime('handed_off')).toBe(false)
  expect(canRecordLandingTime('done')).toBe(false)
  expect(canRecordLandingTime('no-show')).toBe(false)
  expect(canRecordLandingTime('cancelled')).toBe(false)
})

it('allows done from assigned when the copied flag is off, and only from accepted when the flag is on', () => {
  expect(canMarkRideDone('assigned', false)).toBe(true)
  expect(canMarkRideDone('accepted', true)).toBe(true)
  expect(canMarkRideDone('assigned', true)).toBe(false)
  expect(canMarkRideDone('accepted', false)).toBe(false)
  expect(canMarkRideDone('unassigned', null)).toBe(false)
  expect(canMarkRideDone('done', false)).toBe(false)
  expect(canMarkRideDone('done', true)).toBe(false)
  expect(canMarkRideDone('no-show', true)).toBe(false)
  expect(canMarkRideDone('cancelled', false)).toBe(false)
})

it('allows a decline only from assigned, with the copied flag on or off', () => {
  expect(canDeclineRide('assigned')).toBe(true)
  expect(canDeclineRide('accepted')).toBe(false)
  expect(canDeclineRide('unassigned')).toBe(false)
  expect(canDeclineRide('done')).toBe(false)
  expect(canDeclineRide('no-show')).toBe(false)
  expect(canDeclineRide('cancelled')).toBe(false)
})

const otherEnd = 'c1b2c3d4-7777-4777-8777-777777777777'

it('returns an accepted Ride only when the pickup, a place, or the flight number changes', () => {
  const stored = parseCreateTransfer(withEntryKey({ ...body, flightNumber: flight, note }), now)
  expect(canCorrectTransfer('unassigned')).toBe(true)
  expect(canCorrectTransfer('assigned')).toBe(true)
  expect(canCorrectTransfer('accepted')).toBe(true)
  expect(canCorrectTransfer('handed_off')).toBe(true)
  expect(canCorrectTransfer('done')).toBe(false)
  expect(canCorrectTransfer('no-show')).toBe(false)
  expect(canCorrectTransfer('cancelled')).toBe(false)

  const sameFlight = { before: flight, after: flight }
  expect(changedTransferFields(stored, stored)).toEqual([])
  expect(correctionReturnsAcceptedRide('accepted', [], sameFlight)).toBe(false)

  const guestOnly = changedTransferFields(stored, { ...stored, guestName: 'Iva Ivić' })
  expect(guestOnly).toEqual(['guestName'])
  expect(correctionReturnsAcceptedRide('accepted', guestOnly, sameFlight)).toBe(false)
  const referenceOnly = changedTransferFields(stored, { ...stored, clientReference: 'V-19' })
  expect(referenceOnly).toEqual(['clientReference'])
  expect(correctionReturnsAcceptedRide('accepted', referenceOnly, sameFlight)).toBe(false)
  expect(correctionReturnsAcceptedRide('assigned', ['flightNumber'], { before: flight, after: 'OU 392' })).toBe(false)
  expect(correctionReturnsAcceptedRide('unassigned', ['pickupAt'], sameFlight)).toBe(false)

  const sameInstant = changedTransferFields(stored, { ...stored, pickupAt: '2026-10-06T22:30:00Z' })
  expect(sameInstant).toEqual([])

  expect(correctionReturnsAcceptedRide('accepted', changedTransferFields(stored, {
    ...stored,
    pickupAt: '2026-10-06T23:00:00.000Z',
  }), sameFlight)).toBe(true)
  expect(correctionReturnsAcceptedRide('accepted', changedTransferFields(stored, {
    ...stored,
    endLocationId: otherEnd,
  }), sameFlight)).toBe(true)
  expect(correctionReturnsAcceptedRide('accepted', changedTransferFields(stored, {
    ...stored,
    flightNumber: 'OU 392',
  }), { before: flight, after: 'OU 392' })).toBe(true)
  // ADR-0028. Spacing or case is the same designator. The stored text can
  // change, and an accepted Ride stays accepted.
  const spaced = changedTransferFields(stored, { ...stored, flightNumber: 'ou384' })
  expect(spaced).toEqual(['flightNumber'])
  expect(correctionReturnsAcceptedRide('accepted', spaced, { before: flight, after: 'ou384' })).toBe(false)
  const vip = { ...stored, flightNumber: 'VIP' }
  const anotherNote = changedTransferFields(vip, { ...vip, flightNumber: 'meet at desk' })
  expect(anotherNote).toEqual(['flightNumber'])
  expect(correctionReturnsAcceptedRide('accepted', anotherNote, { before: 'VIP', after: 'meet at desk' })).toBe(true)
  expect(correctionReturnsAcceptedRide('accepted', changedTransferFields(stored, {
    ...stored,
    payment: 'card',
    airportMark: true,
    price: '10.00',
  }), sameFlight)).toBe(false)
})
