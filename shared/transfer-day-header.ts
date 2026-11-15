/**
 * Transfer day header summary (ADR-0060).
 * Tags and the hidden-urgent count are derived here so the day query
 * and the #546 filter module stay untouched. The view is not a filter:
 * it never becomes a tag and it does not hide an urgent Ride.
 */

export interface TransferDayHeaderFilterState {
  search: string
  clientId: string | null
  driverId: string | null
  vehicleId: string | null
  partnerId: string | null
  rideState: string
  needsAttention: boolean
  /** Chosen view. Present so a caller cannot forget it, and so a test can prove it is ignored. */
  view: string
}

export interface TransferDayHeaderParty {
  id: string
  name: string
}

export interface TransferDayHeaderParties {
  clients: readonly TransferDayHeaderParty[]
  drivers: readonly TransferDayHeaderParty[]
  vehicles: readonly TransferDayHeaderParty[]
  partners: readonly TransferDayHeaderParty[]
}

/** Field labels and the words used when an id matches nothing. The screen supplies them. */
export interface TransferDayHeaderTagLabels {
  search: string
  client: string
  driver: string
  vehicle: string
  partner: string
  rideState: string
  needsAttention: string
  attentionValue: string
  unknownClient: string
  unknownDriver: string
  unknownVehicle: string
  unknownPartner: string
  rideStateValue: (state: string) => string
}

export const TRANSFER_DAY_HEADER_TAG_KEYS = [
  'search',
  'client',
  'driver',
  'vehicle',
  'partner',
  'rideState',
  'attention',
] as const

export type TransferDayHeaderTagKey = (typeof TRANSFER_DAY_HEADER_TAG_KEYS)[number]

export interface TransferDayHeaderTag {
  key: TransferDayHeaderTagKey
  /** "Label: value", the text the office reads and the remove button names. */
  text: string
}

const COLLAPSED = 'collapsed'

/**
 * "Filtri (n)" counts the fields behind the button.
 * Search stays outside that disclosure, and the view is not a field.
 */
export function fieldFilterCount(state: TransferDayHeaderFilterState): number {
  let count = 0
  if (present(state.clientId))
    count += 1
  if (present(state.driverId))
    count += 1
  if (present(state.vehicleId))
    count += 1
  if (present(state.partnerId))
    count += 1
  if (state.rideState !== '')
    count += 1
  if (state.needsAttention)
    count += 1
  return count
}

/** Search counts here. The view does not: a view alone does not hide urgent Rides. */
export function headerFiltersActive(state: TransferDayHeaderFilterState): boolean {
  return state.search.trim() !== '' || fieldFilterCount(state) > 0
}

/**
 * Urgent Rides of the day minus urgent Rides still in the filtered set.
 * Without a filter the line stays hidden, even if the two numbers differ,
 * because that difference would be the view and the view does not count.
 */
export function hiddenUrgentCount(
  urgentInDay: number,
  urgentAfterFilters: number,
  state: TransferDayHeaderFilterState,
): number {
  if (!headerFiltersActive(state))
    return 0
  const hidden = urgentInDay - urgentAfterFilters
  return hidden > 0 ? hidden : 0
}

/** Tag order is the field order: search, then the disclosure fields. The view is left out. */
export function filterSummaryTags(
  state: TransferDayHeaderFilterState,
  labels: TransferDayHeaderTagLabels,
  parties: TransferDayHeaderParties,
): TransferDayHeaderTag[] {
  const tags: TransferDayHeaderTag[] = []
  const search = state.search.trim()
  if (search !== '')
    tags.push(tag('search', labels.search, state.search.trim()))
  const client = partyTag(state.clientId, parties.clients, labels.client, labels.unknownClient)
  if (client)
    tags.push({ key: 'client', text: client })
  const driver = partyTag(state.driverId, parties.drivers, labels.driver, labels.unknownDriver)
  if (driver)
    tags.push({ key: 'driver', text: driver })
  const vehicle = partyTag(state.vehicleId, parties.vehicles, labels.vehicle, labels.unknownVehicle)
  if (vehicle)
    tags.push({ key: 'vehicle', text: vehicle })
  const partner = partyTag(state.partnerId, parties.partners, labels.partner, labels.unknownPartner)
  if (partner)
    tags.push({ key: 'partner', text: partner })
  if (state.rideState !== '')
    tags.push(tag('rideState', labels.rideState, labels.rideStateValue(state.rideState)))
  if (state.needsAttention)
    tags.push(tag('attention', labels.needsAttention, labels.attentionValue))
  return tags
}

/** Absent, or any value other than collapsed, leaves the fields open. Same rule as the occupation strip. */
export function readTransferDayFiltersCollapsed(
  storage: { getItem: (key: string) => string | null },
  key: string,
): boolean {
  return storage.getItem(key) === COLLAPSED
}

export function writeTransferDayFiltersCollapsed(
  storage: { setItem: (key: string, value: string) => void },
  key: string,
  collapsed: boolean,
): void {
  storage.setItem(key, collapsed ? COLLAPSED : 'open')
}

export function transferDayFiltersStorageKey(tenantId: string, userId: string): string {
  return `transferpro-transfer-day-filters:${tenantId}:${userId}`
}

function present(id: string | null): boolean {
  return id !== null && id !== ''
}

function partyTag(
  id: string | null,
  parties: readonly TransferDayHeaderParty[],
  label: string,
  unknown: string,
): string | null {
  if (!present(id))
    return null
  const found = parties.find(party => party.id === id)
  return `${label}: ${found ? found.name : unknown}`
}

function tag(key: TransferDayHeaderTagKey, label: string, value: string): TransferDayHeaderTag {
  return { key, text: `${label}: ${value}` }
}
