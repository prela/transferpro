import { expect, it } from 'vitest'
import { applyTransferDraftEvent, recallTransferDraft, rememberTransferDraft, TRANSFER_DRAFT_TTL_MS, transferDraftIsBlank, transferDraftKey, transferEntryKey, transferMoreHasValue } from './transfer-draft'

/**
 * The new-Transfer draft (issue #259). Expected outcomes are the ADR-0038
 * rules: one key per user and Tenant, gone after 24 hours, and gone on
 * save, discard, and sign-out. The store is a memory map, not the browser.
 */

const USER = 'user-a'
const OTHER_USER = 'user-b'
const TENANT = '00000000-0000-4000-8000-0000000000aa'
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000bb'
const NOW = new Date('2026-10-16T12:00:00.000Z')

function memory() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
    removeItem: (key: string) => {
      items.delete(key)
    },
  }
}

function fields(overrides: Partial<Parameters<typeof rememberTransferDraft>[3]> = {}) {
  return {
    clientId: null,
    pickupWall: '2026-10-16T12:00',
    startLocationId: null,
    endLocationId: null,
    passengers: '1',
    guest: 'Ana Anić',
    price: '42,50',
    payment: 'cash' as const,
    flight: 'OU384',
    airportMark: true,
    tabla: 'GOSPOĐA',
    clientReference: 'V-19',
    luggage: '2',
    childSeats: '1',
    note: 'kasni',
    ...overrides,
  }
}

it('keys a draft by user and Tenant, so another user or Tenant cannot read it', () => {
  const store = memory()
  rememberTransferDraft(store, USER, TENANT, fields(), NOW)

  expect(transferDraftKey(USER, TENANT)).not.toBe(transferDraftKey(OTHER_USER, TENANT))
  expect(transferDraftKey(USER, TENANT)).not.toBe(transferDraftKey(USER, OTHER_TENANT))
  expect(recallTransferDraft(store, USER, TENANT, NOW)?.guest).toBe('Ana Anić')
  expect(recallTransferDraft(store, OTHER_USER, TENANT, NOW)).toBeNull()
  expect(recallTransferDraft(store, USER, OTHER_TENANT, NOW)).toBeNull()
  expect(store.getItem(transferDraftKey(USER, TENANT))).not.toBeNull()
})

it('drops a draft once it is 24 hours old and keeps one that is younger', () => {
  const store = memory()
  rememberTransferDraft(store, USER, TENANT, fields(), NOW)
  const fresh = new Date(NOW.getTime() + TRANSFER_DRAFT_TTL_MS - 1)
  const expired = new Date(NOW.getTime() + TRANSFER_DRAFT_TTL_MS)

  expect(recallTransferDraft(store, USER, TENANT, fresh)?.guest).toBe('Ana Anić')
  expect(recallTransferDraft(store, USER, TENANT, expired)).toBeNull()
  expect(store.getItem(transferDraftKey(USER, TENANT))).toBeNull()
})

it('sign-out removes only the active Tenant draft and leaves the other until it expires', () => {
  const store = memory()
  rememberTransferDraft(store, USER, TENANT, fields(), NOW)
  rememberTransferDraft(store, USER, OTHER_TENANT, fields({ guest: 'Boris Skica' }), NOW)

  applyTransferDraftEvent(store, USER, TENANT, 'sign-out')

  expect(recallTransferDraft(store, USER, TENANT, NOW)).toBeNull()
  expect(recallTransferDraft(store, USER, OTHER_TENANT, NOW)?.guest).toBe('Boris Skica')
  expect(store.getItem(transferDraftKey(USER, OTHER_TENANT))).not.toBeNull()
})

it('clears the draft on save, on discard, and on sign-out, and leaves it while editing', () => {
  for (const event of ['save', 'discard', 'sign-out'] as const) {
    const store = memory()
    rememberTransferDraft(store, USER, TENANT, fields(), NOW)
    applyTransferDraftEvent(store, USER, TENANT, event)
    expect(store.getItem(transferDraftKey(USER, TENANT))).toBeNull()
  }

  const store = memory()
  rememberTransferDraft(store, USER, TENANT, fields(), NOW)
  applyTransferDraftEvent(store, USER, TENANT, 'edit')
  expect(recallTransferDraft(store, USER, TENANT, NOW)?.guest).toBe('Ana Anić')
})

it('stores the booking the form shows and nothing that would identify an email', () => {
  const store = memory()
  rememberTransferDraft(store, USER, TENANT, fields(), NOW)
  const stored = JSON.parse(store.getItem(transferDraftKey(USER, TENANT)) ?? '{}') as Record<string, unknown>

  expect(Object.keys(stored).sort()).toEqual([
    'airportMark',
    'childSeats',
    'clientId',
    'clientReference',
    'endLocationId',
    'flight',
    'guest',
    'luggage',
    'note',
    'passengers',
    'payment',
    'pickupWall',
    'price',
    'savedAt',
    'startLocationId',
    'tabla',
    'tenantId',
    'userId',
  ])
  expect(stored).not.toHaveProperty('email')
  expect(recallTransferDraft(store, USER, TENANT, NOW)?.flight).toBe('OU384')
})

const ENTRY_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

it('creates an entry key for a blank form, a duplicate, a return journey, and an extra vehicle, and none for a correction', () => {
  const issued = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ]
  let next = 0
  const random = () => issued[next++]!

  // ADR-0035: each new entry gets its own key. A correction refuses one.
  // An extra vehicle is a new Transfer, so it gets a key of its own.
  expect(transferEntryKey('blank', random)).toBe(issued[0])
  expect(transferEntryKey('duplicate', random)).toBe(issued[1])
  expect(transferEntryKey('return', random)).toBe(issued[2])
  expect(transferEntryKey('extra', random)).toBe(issued[3])
  expect(transferEntryKey('correction', random)).toBeNull()
  expect(next).toBe(4)
})

it('keeps an extra vehicle linked to its main Transfer across a reload', () => {
  const store = memory()
  const mainTransferId = 'd4d4d4d4-4444-4444-8444-444444444444'
  rememberTransferDraft(store, USER, TENANT, fields({
    price: '0',
    passengers: '',
    luggage: '',
    childSeats: '',
    note: '',
    mainTransferId,
    mainVersion: 0,
    groupPassengers: '8',
  }), NOW)

  // A reload must not become an ordinary Transfer: the Price is 0 only
  // because the link is still here.
  expect(recallTransferDraft(store, USER, TENANT, NOW)).toMatchObject({
    price: '0',
    mainTransferId,
    mainVersion: 0,
    groupPassengers: '8',
  })
})

it('keeps the entry key across a reload, and keeps the draft after already recorded until the notice is confirmed', () => {
  const store = memory()
  rememberTransferDraft(store, USER, TENANT, fields({ externalId: ENTRY_KEY }), NOW)

  // A reload reads the same key. The blank clock does not count as a draft,
  // so a key on an otherwise empty form is not stored.
  expect(recallTransferDraft(store, USER, TENANT, NOW)?.externalId).toBe(ENTRY_KEY)
  const blankWithKey = fields({
    guest: '',
    price: '',
    payment: null,
    flight: '',
    airportMark: false,
    tabla: '',
    clientReference: '',
    luggage: '0',
    childSeats: '0',
    note: '',
    pickupWall: '2026-10-16T12:00',
    externalId: ENTRY_KEY,
  })
  expect(transferDraftIsBlank(blankWithKey, '2026-10-16T12:00')).toBe(true)
  const blankStore = memory()
  rememberTransferDraft(blankStore, USER, TENANT, blankWithKey, NOW, '2026-10-16T12:00')
  expect(blankStore.getItem(transferDraftKey(USER, TENANT))).toBeNull()

  const kept = memory()
  rememberTransferDraft(kept, USER, TENANT, fields({ externalId: ENTRY_KEY }), NOW)
  applyTransferDraftEvent(kept, USER, TENANT, 'already-recorded')
  expect(recallTransferDraft(kept, USER, TENANT, NOW)?.externalId).toBe(ENTRY_KEY)
  expect(recallTransferDraft(kept, USER, TENANT, NOW)?.guest).toBe('Ana Anić')

  applyTransferDraftEvent(kept, USER, TENANT, 'save')
  expect(recallTransferDraft(kept, USER, TENANT, NOW)).toBeNull()

  const discarded = memory()
  rememberTransferDraft(discarded, USER, TENANT, fields({ externalId: ENTRY_KEY }), NOW)
  applyTransferDraftEvent(discarded, USER, TENANT, 'discard')
  expect(discarded.getItem(transferDraftKey(USER, TENANT))).toBeNull()
})

it('treats a blank new Transfer as nothing to keep, and opens Više only when one of its fields has a value', () => {
  expect(transferDraftIsBlank(fields({
    guest: '  ',
    price: '',
    payment: null,
    flight: '',
    airportMark: false,
    tabla: '',
    clientReference: '',
    luggage: '0',
    childSeats: '0',
    note: '',
  }))).toBe(true)
  expect(transferDraftIsBlank(fields())).toBe(false)
  const clockOnly = fields({
    guest: '',
    price: '',
    payment: null,
    flight: '',
    airportMark: false,
    tabla: '',
    clientReference: '',
    luggage: '0',
    childSeats: '0',
    note: '',
    pickupWall: '2026-10-16T15:00',
  })
  expect(transferDraftIsBlank(clockOnly, '2026-10-16T12:00')).toBe(false)
  expect(transferDraftIsBlank({ ...clockOnly, pickupWall: '2026-10-16T12:00', clientReference: 'V-19' }, '2026-10-16T12:00')).toBe(false)
  expect(transferDraftIsBlank({ ...clockOnly, pickupWall: '2026-10-16T12:00' }, '2026-10-16T12:00')).toBe(true)

  const empty = {
    flight: '',
    airportMark: false,
    tabla: '',
    luggage: '0',
    childSeats: '0',
    note: '',
  }
  expect(transferMoreHasValue(empty)).toBe(false)
  expect(transferMoreHasValue({ ...empty, flight: 'OU1' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, airportMark: true })).toBe(true)
  expect(transferMoreHasValue({ ...empty, tabla: 'A' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, luggage: '1' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, childSeats: '1' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, note: 'x' })).toBe(true)
})
