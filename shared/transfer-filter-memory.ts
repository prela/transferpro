import type { TransferBoardFilter } from './ride-attention'
import type { TransferDayRideStateFilter } from './transfer-day-query'
import { z } from 'zod'
import { parseTransferDayFilter } from './ride-attention'
import { parseTransferDayRideState } from './transfer-day-query'

/**
 * Remembered Transfer view and filters for one tab (ADR-0064).
 * The day and the open Ride are address keys, so a link that carries either
 * one replaces the memory, and neither is stored. The menu stays a bare
 * `/transfers` and restores this memory on the current operational day.
 * The day query and the #546 filter module stay untouched.
 */

export const TRANSFER_FILTER_MEMORY_PREFIX = 'transferpro-transfer-filters:'

/** Keys the Transfers screen owns. Any one of them on arrival is a link. */
export const TRANSFER_FILTER_ADDRESS_KEYS = [
  'day',
  'filter',
  'search',
  'client',
  'driver',
  'vehicle',
  'partner',
  'rideState',
  'attention',
  'ride',
] as const

export interface TransferFilterMemory {
  readonly filter: TransferBoardFilter
  readonly search: string
  readonly clientId: string | null
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly partnerId: string | null
  readonly rideState: TransferDayRideStateFilter | ''
  readonly needsAttention: boolean
}

export type TransferFilterMemoryDecision
  = | { readonly action: 'restore', readonly memory: TransferFilterMemory }
    | { readonly action: 'replace', readonly memory: TransferFilterMemory }
    | { readonly action: 'ignore', readonly dropStored: boolean }

/** `sessionStorage` satisfies it. `keys` lists every key in the tab. */
export interface TransferFilterMemoryStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  keys: () => readonly string[]
}

const storedSchema = z.object({
  filter: z.string().refine(value => parseTransferDayFilter(value) === value).optional(),
  search: z.string().min(1).optional(),
  client: z.uuid().optional(),
  driver: z.uuid().optional(),
  vehicle: z.uuid().optional(),
  partner: z.uuid().optional(),
  rideState: z.string().refine(value => value !== '' && parseTransferDayRideState(value) === value).optional(),
  attention: z.literal('1').optional(),
}).strict()

const EMPTY: TransferFilterMemory = {
  filter: 'all',
  search: '',
  clientId: null,
  driverId: null,
  vehicleId: null,
  partnerId: null,
  rideState: '',
  needsAttention: false,
}

/** Same shape as the occupation strip: Tenant, then user. */
export function transferFilterMemoryKey(tenantId: string, userId: string): string {
  return `${TRANSFER_FILTER_MEMORY_PREFIX}${tenantId}:${userId}`
}

/**
 * A bare address restores a stored value that parses. Any owned address key
 * replaces, and the memory leaves out `day` and `ride`. An unreadable stored
 * value is ignored; the caller removes it.
 */
export function decideTransferFilterMemory(query: object, stored: string | null): TransferFilterMemoryDecision {
  const address = query as Record<string, unknown>
  if (hasAddressKey(address))
    return { action: 'replace', memory: memoryFromQuery(address) }
  if (stored === null)
    return { action: 'ignore', dropStored: false }
  const memory = memoryFromStored(stored)
  if (memory === null)
    return { action: 'ignore', dropStored: true }
  return { action: 'restore', memory }
}

/** Address keys for a replace, without the day and without the open Ride. */
export function transferFilterMemoryQuery(memory: TransferFilterMemory): Record<string, string> {
  const query: Record<string, string> = {}
  if (memory.filter !== 'all')
    query.filter = memory.filter
  if (memory.search.trim() !== '')
    query.search = memory.search
  const client = uuidOrNull(memory.clientId)
  if (client)
    query.client = client
  const driver = uuidOrNull(memory.driverId)
  if (driver)
    query.driver = driver
  const vehicle = uuidOrNull(memory.vehicleId)
  if (vehicle)
    query.vehicle = vehicle
  const partner = uuidOrNull(memory.partnerId)
  if (partner)
    query.partner = partner
  if (memory.rideState !== '')
    query.rideState = memory.rideState
  if (memory.needsAttention)
    query.attention = '1'
  return query
}

export function rememberTransferFilterMemory(
  store: TransferFilterMemoryStore,
  tenantId: string,
  userId: string,
  memory: TransferFilterMemory,
): void {
  store.setItem(transferFilterMemoryKey(tenantId, userId), JSON.stringify(transferFilterMemoryQuery(memory)))
}

/** A Tenant switch forgets the company that was left and leaves the other keys. */
export function forgetTransferFilterMemory(store: TransferFilterMemoryStore, tenantId: string, userId: string): void {
  store.removeItem(transferFilterMemoryKey(tenantId, userId))
}

/** Sign-out, the idle sign-out, and a successful sign-in drop every key of this kind. */
export function clearTransferFilterMemory(store: TransferFilterMemoryStore): void {
  // Copy first. Removing a key while walking sessionStorage skips the next one.
  for (const key of [...store.keys()]) {
    if (key.startsWith(TRANSFER_FILTER_MEMORY_PREFIX))
      store.removeItem(key)
  }
}

function hasAddressKey(query: Record<string, unknown>): boolean {
  return TRANSFER_FILTER_ADDRESS_KEYS.some(key => Object.hasOwn(query, key) && query[key] !== undefined)
}

function memoryFromQuery(query: Record<string, unknown>): TransferFilterMemory {
  return {
    filter: parseTransferDayFilter(query.filter),
    search: typeof query.search === 'string' ? query.search : '',
    clientId: uuidOrNull(typeof query.client === 'string' ? query.client : null),
    driverId: uuidOrNull(typeof query.driver === 'string' ? query.driver : null),
    vehicleId: uuidOrNull(typeof query.vehicle === 'string' ? query.vehicle : null),
    partnerId: uuidOrNull(typeof query.partner === 'string' ? query.partner : null),
    rideState: parseTransferDayRideState(query.rideState),
    needsAttention: query.attention === '1',
  }
}

function memoryFromStored(raw: string): TransferFilterMemory | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return null
  }
  const result = storedSchema.safeParse(parsed)
  if (!result.success)
    return null
  const data = result.data
  return {
    ...EMPTY,
    filter: data.filter === undefined ? 'all' : parseTransferDayFilter(data.filter),
    search: data.search ?? '',
    clientId: data.client ?? null,
    driverId: data.driver ?? null,
    vehicleId: data.vehicle ?? null,
    partnerId: data.partner ?? null,
    rideState: data.rideState === undefined ? '' : parseTransferDayRideState(data.rideState),
    needsAttention: data.attention === '1',
  }
}

function uuidOrNull(value: string | null): string | null {
  if (value === null)
    return null
  return z.uuid().safeParse(value).success ? value : null
}
