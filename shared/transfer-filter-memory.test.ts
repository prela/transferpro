import type { TransferFilterMemory } from './transfer-filter-memory'
import { expect, it } from 'vitest'
import { clearTransferFilterMemory, decideTransferFilterMemory, forgetTransferFilterMemory, rememberTransferFilterMemory, TRANSFER_FILTER_MEMORY_PREFIX, transferFilterMemoryKey, transferFilterMemoryQuery } from './transfer-filter-memory'

/**
 * Remembered Transfer view and filters (ADR-0064). Expected values are the
 * address keys a link would carry, not a second pass through the parser.
 */

const TENANT = '00000000-0000-4000-8000-0000000000a1'
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000a2'
const USER = 'user-one'
const OTHER_USER = 'user-two'
const CLIENT = '00000000-0000-4000-8000-000000000001'
const DRIVER = '00000000-0000-4000-8000-000000000010'
const VEHICLE = '00000000-0000-4000-8000-000000000020'
const PARTNER = '00000000-0000-4000-8000-000000000030'
const RIDE = '00000000-0000-4000-8000-000000000040'

const stored = JSON.stringify({
  filter: 'toInvoice',
  search: 'OU222',
  client: CLIENT,
  driver: DRIVER,
  vehicle: VEHICLE,
  partner: PARTNER,
  rideState: 'waiting',
  attention: '1',
})

const remembered = {
  filter: 'toInvoice',
  search: 'OU222',
  clientId: CLIENT,
  driverId: DRIVER,
  vehicleId: VEHICLE,
  partnerId: PARTNER,
  rideState: 'waiting',
  needsAttention: true,
} as const

function memoryStore() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    keys: () => [...values.keys()],
  }
}

it('restores a bare address from the stored view, search, and six fields', () => {
  expect(decideTransferFilterMemory({}, stored)).toEqual({ action: 'restore', memory: remembered })
  expect(decideTransferFilterMemory({ panel: 'open' }, stored)).toEqual({ action: 'restore', memory: remembered })
  expect(transferFilterMemoryQuery(remembered)).toEqual({
    filter: 'toInvoice',
    search: 'OU222',
    client: CLIENT,
    driver: DRIVER,
    vehicle: VEHICLE,
    partner: PARTNER,
    rideState: 'waiting',
    attention: '1',
  })
})

it('replaces when any address key is present and drops the day and the open Ride', () => {
  expect(decideTransferFilterMemory({
    day: '2026-11-03',
    ride: RIDE,
    filter: 'assignedNotStarted',
    search: 'Ana',
    client: CLIENT,
    driver: DRIVER,
    vehicle: VEHICLE,
    partner: PARTNER,
    rideState: 'handedOff',
    attention: '1',
  }, stored)).toEqual({
    action: 'replace',
    memory: {
      filter: 'assignedNotStarted',
      search: 'Ana',
      clientId: CLIENT,
      driverId: DRIVER,
      vehicleId: VEHICLE,
      partnerId: PARTNER,
      rideState: 'handedOff',
      needsAttention: true,
    },
  })
  expect(transferFilterMemoryQuery({
    filter: 'assignedNotStarted',
    search: 'Ana',
    clientId: CLIENT,
    driverId: DRIVER,
    vehicleId: VEHICLE,
    partnerId: PARTNER,
    rideState: 'handedOff',
    needsAttention: true,
  })).toEqual({
    filter: 'assignedNotStarted',
    search: 'Ana',
    client: CLIENT,
    driver: DRIVER,
    vehicle: VEHICLE,
    partner: PARTNER,
    rideState: 'handedOff',
    attention: '1',
  })

  const empty: TransferFilterMemory = {
    filter: 'all',
    search: '',
    clientId: null,
    driverId: null,
    vehicleId: null,
    partnerId: null,
    rideState: '',
    needsAttention: false,
  }
  expect(decideTransferFilterMemory({ day: '2026-11-03' }, stored)).toEqual({ action: 'replace', memory: empty })
  expect(decideTransferFilterMemory({ ride: RIDE }, stored)).toEqual({ action: 'replace', memory: empty })
  expect(decideTransferFilterMemory({ filter: 'urgent' }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, filter: 'urgent' },
  })
  expect(decideTransferFilterMemory({ search: 'OU111' }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, search: 'OU111' },
  })
  expect(decideTransferFilterMemory({ client: CLIENT }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, clientId: CLIENT },
  })
  expect(decideTransferFilterMemory({ driver: DRIVER }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, driverId: DRIVER },
  })
  expect(decideTransferFilterMemory({ vehicle: VEHICLE }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, vehicleId: VEHICLE },
  })
  expect(decideTransferFilterMemory({ partner: PARTNER }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, partnerId: PARTNER },
  })
  expect(decideTransferFilterMemory({ rideState: 'closed' }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, rideState: 'closed' },
  })
  expect(decideTransferFilterMemory({ attention: '1' }, stored)).toEqual({
    action: 'replace',
    memory: { ...empty, needsAttention: true },
  })
  expect(transferFilterMemoryQuery(empty)).toEqual({})
})

it('ignores an unreadable stored value and leaves a missing one alone', () => {
  expect(decideTransferFilterMemory({}, null)).toEqual({ action: 'ignore', dropStored: false })
  expect(decideTransferFilterMemory({}, '')).toEqual({ action: 'ignore', dropStored: true })
  expect(decideTransferFilterMemory({}, '{')).toEqual({ action: 'ignore', dropStored: true })
  expect(decideTransferFilterMemory({}, JSON.stringify({ filter: 'nope' }))).toEqual({ action: 'ignore', dropStored: true })
  expect(decideTransferFilterMemory({}, JSON.stringify({ day: '2026-11-16', filter: 'urgent' }))).toEqual({ action: 'ignore', dropStored: true })
  expect(decideTransferFilterMemory({}, JSON.stringify({ ride: RIDE }))).toEqual({ action: 'ignore', dropStored: true })
  expect(decideTransferFilterMemory({}, JSON.stringify({ client: 'not-a-uuid' }))).toEqual({ action: 'ignore', dropStored: true })
  expect(decideTransferFilterMemory({}, JSON.stringify({ attention: true }))).toEqual({ action: 'ignore', dropStored: true })
  expect(decideTransferFilterMemory({}, '[]')).toEqual({ action: 'ignore', dropStored: true })
})

it('keeps the key per Tenant and user, and sign-out removes every key of this kind', () => {
  const store = memoryStore()
  expect(transferFilterMemoryKey(TENANT, USER)).toBe(`${TRANSFER_FILTER_MEMORY_PREFIX}${TENANT}:${USER}`)
  expect(transferFilterMemoryKey(TENANT, USER)).not.toBe(transferFilterMemoryKey(OTHER_TENANT, USER))
  expect(transferFilterMemoryKey(TENANT, USER)).not.toBe(transferFilterMemoryKey(TENANT, OTHER_USER))

  rememberTransferFilterMemory(store, TENANT, USER, remembered)
  rememberTransferFilterMemory(store, OTHER_TENANT, USER, {
    filter: 'urgent',
    search: '',
    clientId: null,
    driverId: null,
    vehicleId: null,
    partnerId: null,
    rideState: '',
    needsAttention: false,
  })
  store.setItem('transferpro-transfer-draft:user:tenant', '{"guest":"Ana Skica"}')
  store.setItem(`transferpro-occupation-strip:${TENANT}:${USER}`, 'collapsed')

  expect(JSON.parse(store.getItem(transferFilterMemoryKey(TENANT, USER)) ?? '')).toEqual({
    filter: 'toInvoice',
    search: 'OU222',
    client: CLIENT,
    driver: DRIVER,
    vehicle: VEHICLE,
    partner: PARTNER,
    rideState: 'waiting',
    attention: '1',
  })

  forgetTransferFilterMemory(store, TENANT, USER)
  expect(store.getItem(transferFilterMemoryKey(TENANT, USER))).toBeNull()
  expect(store.getItem(transferFilterMemoryKey(OTHER_TENANT, USER))).not.toBeNull()

  clearTransferFilterMemory(store)
  expect(store.keys().filter(key => key.startsWith(TRANSFER_FILTER_MEMORY_PREFIX))).toEqual([])
  expect(store.getItem('transferpro-transfer-draft:user:tenant')).toBe('{"guest":"Ana Skica"}')
  expect(store.getItem(`transferpro-occupation-strip:${TENANT}:${USER}`)).toBe('collapsed')
})
