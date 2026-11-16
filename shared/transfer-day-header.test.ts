import type { TransferDayHeaderFilterState, TransferDayHeaderTagLabels } from './transfer-day-header'
import { expect, it } from 'vitest'
import {
  fieldFilterCount,
  filterSummaryTags,
  hiddenUrgentCount,
  readTransferDayFiltersCollapsed,
  transferDayFiltersStorageKey,
  writeTransferDayFiltersCollapsed,
} from './transfer-day-header'

/**
 * Header summary tags and the hidden-urgent line (ADR-0060).
 * Expected words are the Croatian labels the office reads, not a second
 * pass through the same lookup the screen will do.
 */

const CLIENT = '00000000-0000-4000-8000-000000000001'
const MISSING = '00000000-0000-4000-8000-000000000099'
const DRIVER = '00000000-0000-4000-8000-000000000010'
const VEHICLE = '00000000-0000-4000-8000-000000000020'
const PARTNER = '00000000-0000-4000-8000-000000000030'

const labels: TransferDayHeaderTagLabels = {
  search: 'Traži u danu',
  client: 'Naručitelj',
  driver: 'Vozač',
  vehicle: 'Vozilo',
  partner: 'Podizvođač',
  rideState: 'Stanje vožnje',
  needsAttention: 'Treba pažnju',
  attentionValue: 'da',
  unknownClient: 'Nepoznat naručitelj',
  unknownDriver: 'Nepoznat vozač',
  unknownVehicle: 'Nepoznato vozilo',
  unknownPartner: 'Nepoznat podizvođač',
  rideStateValue: state => state === 'unassigned' ? 'Nedodijeljeno' : state,
}

const parties = {
  clients: [{ id: CLIENT, name: 'Agencija Ana' }],
  drivers: [{ id: DRIVER, name: 'Marko Filter' }],
  vehicles: [{ id: VEHICLE, name: 'ZG546AA' }],
  partners: [{ id: PARTNER, name: 'Prijevoz Suženo' }],
}

function state(overrides: Partial<TransferDayHeaderFilterState> = {}): TransferDayHeaderFilterState {
  return {
    search: '',
    clientId: null,
    driverId: null,
    vehicleId: null,
    partnerId: null,
    rideState: '',
    needsAttention: false,
    view: 'all',
    ...overrides,
  }
}

it('builds tags in field order and leaves the view out', () => {
  const tags = filterSummaryTags(state({
    search: '  OU222  ',
    clientId: CLIENT,
    driverId: DRIVER,
    vehicleId: VEHICLE,
    partnerId: PARTNER,
    rideState: 'unassigned',
    needsAttention: true,
    view: 'urgent',
  }), labels, parties)
  expect(tags.map(tag => tag.text)).toEqual([
    'Traži u danu: OU222',
    'Naručitelj: Agencija Ana',
    'Vozač: Marko Filter',
    'Vozilo: ZG546AA',
    'Podizvođač: Prijevoz Suženo',
    'Stanje vožnje: Nedodijeljeno',
    'Treba pažnju: da',
  ])
  expect(tags.map(tag => tag.key)).not.toContain('urgent')
  expect(fieldFilterCount(state({
    search: 'OU222',
    clientId: CLIENT,
    driverId: DRIVER,
    vehicleId: VEHICLE,
    partnerId: PARTNER,
    rideState: 'unassigned',
    needsAttention: true,
    view: 'urgent',
  }))).toBe(6)
})

it('names an id that matches no record and ignores a blank search', () => {
  const tags = filterSummaryTags(state({
    search: '   ',
    clientId: MISSING,
    driverId: MISSING,
    vehicleId: MISSING,
    partnerId: MISSING,
    view: 'done',
  }), labels, parties)
  expect(tags.map(tag => tag.text)).toEqual([
    'Naručitelj: Nepoznat naručitelj',
    'Vozač: Nepoznat vozač',
    'Vozilo: Nepoznato vozilo',
    'Podizvođač: Nepoznat podizvođač',
  ])
  expect(fieldFilterCount(state({ search: 'OU222', view: 'done' }))).toBe(0)
})

it('counts urgent Rides a filter hides, and ignores the view', () => {
  expect(hiddenUrgentCount(3, 1, state({ search: 'predani', view: 'all' }))).toBe(2)
  expect(hiddenUrgentCount(3, 1, state({ driverId: DRIVER, view: 'all' }))).toBe(2)
  expect(hiddenUrgentCount(3, 3, state({ clientId: CLIENT, view: 'urgent' }))).toBe(0)
  expect(hiddenUrgentCount(3, 0, state({ view: 'urgent' }))).toBe(0)
  expect(hiddenUrgentCount(1, 4, state({ needsAttention: true }))).toBe(0)
})

it('remembers a collapsed filter disclosure per user and Tenant', () => {
  const stored = new Map<string, string>()
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value)
    },
  }
  const key = transferDayFiltersStorageKey('tenant-a', 'user-a')
  expect(readTransferDayFiltersCollapsed(storage, key)).toBe(false)
  writeTransferDayFiltersCollapsed(storage, key, true)
  expect(readTransferDayFiltersCollapsed(storage, key)).toBe(true)
  expect(readTransferDayFiltersCollapsed(storage, transferDayFiltersStorageKey('tenant-a', 'user-b'))).toBe(false)
  writeTransferDayFiltersCollapsed(storage, key, false)
  expect(readTransferDayFiltersCollapsed(storage, key)).toBe(false)
})
