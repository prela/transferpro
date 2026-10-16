import { expect, it } from 'vitest'
import { applyTransferDraftEvent, recallTransferDraft, rememberTransferDraft, TRANSFER_DRAFT_TTL_MS, transferDraftIsBlank, transferDraftKey, transferMoreHasValue } from './transfer-draft'

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
    clientReference: '',
    luggage: '0',
    childSeats: '0',
    note: '',
  }
  expect(transferMoreHasValue(empty)).toBe(false)
  expect(transferMoreHasValue({ ...empty, clientReference: 'V-19' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, flight: 'OU1' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, airportMark: true })).toBe(true)
  expect(transferMoreHasValue({ ...empty, tabla: 'A' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, luggage: '1' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, childSeats: '1' })).toBe(true)
  expect(transferMoreHasValue({ ...empty, note: 'x' })).toBe(true)
})
