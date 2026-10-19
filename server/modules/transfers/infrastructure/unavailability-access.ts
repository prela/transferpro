import type { UnavailabilitySaved, UnavailabilityWindowView } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { UnavailabilityAuditFact } from '../../capacity'
import {
  auditFactSchema,
  parseChangeUnavailability,
  parseRecordUnavailability,
  parseUnavailabilityId,
  parseUnavailabilityResourceId,
  parseUnavailabilityWeek,
  unavailabilityWeekRange,
} from '../../../../shared'
import { appendAuditEntry } from '../../audit'
import {
  changeUnavailability as changeWindow,
  listUnavailabilityDuring,
  listUnavailabilityOf,
  recordUnavailability,
  removeUnavailability as removeWindow,
  unavailabilityPorts,
} from '../../capacity'
import { loadTenantSettings, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { rideOccupation } from './occupation-port'

/*
 * The HTTP side of the unavailability windows (ADR-0034). Capacity owns the
 * commands; these open the tenant session and wire in the two things only
 * transfers may pass: the occupation adapter and the audit append. The
 * Tenant comes from the session. The body or the path is parsed first, so
 * a bad request opens no session. Capacity enforces the office role itself.
 */

function ports(transaction: TenantTransaction, actorUserId: string) {
  return unavailabilityPorts(transaction, rideOccupation(transaction), async (fact: UnavailabilityAuditFact) => {
    const { action, ...data } = fact
    // The shared shape narrows the action to its data, and refuses an instant in it.
    const entry = auditFactSchema.parse({ action, subjectUserId: null, data })
    await appendAuditEntry(transaction, { ...entry, actorUserId })
  })
}

/** Add a window for one Driver or one Vehicle. Answers the window and the Rides it now covers. */
export async function addUnavailability(headers: Headers, raw: unknown): Promise<UnavailabilitySaved> {
  const input = parseRecordUnavailability(raw)
  return withTenantFromSession(headers, ({ actor, transaction }) =>
    recordUnavailability(ports(transaction, actor.userId), actor.role, input))
}

/** Move a window's instants. Answers the window and the Rides it now covers. */
export async function changeUnavailability(headers: Headers, rawWindowId: unknown, raw: unknown): Promise<UnavailabilitySaved> {
  const input = parseChangeUnavailability(rawWindowId, raw)
  return withTenantFromSession(headers, ({ actor, transaction }) =>
    changeWindow(ports(transaction, actor.userId), actor.role, input))
}

/** Mark a window removed. It no longer counts. */
export async function removeUnavailability(headers: Headers, rawWindowId: unknown): Promise<void> {
  const windowId = parseUnavailabilityId(rawWindowId)
  await withTenantFromSession(headers, ({ actor, transaction }) =>
    removeWindow(ports(transaction, actor.userId), actor.role, windowId))
}

/** The live windows of one Driver. */
export async function listDriverUnavailability(headers: Headers, rawDriverId: unknown): Promise<UnavailabilityWindowView[]> {
  const id = parseUnavailabilityResourceId(rawDriverId)
  return withTenantFromSession(headers, ({ actor, transaction }) =>
    listUnavailabilityOf(ports(transaction, actor.userId), actor.role, { kind: 'driver', id }))
}

/** The live windows of one Vehicle. */
export async function listVehicleUnavailability(headers: Headers, rawVehicleId: unknown): Promise<UnavailabilityWindowView[]> {
  const id = parseUnavailabilityResourceId(rawVehicleId)
  return withTenantFromSession(headers, ({ actor, transaction }) =>
    listUnavailabilityOf(ports(transaction, actor.userId), actor.role, { kind: 'vehicle', id }))
}

/** The Tenant's live windows that touch one roster week, Monday to Sunday in the Tenant time zone. */
export async function listUnavailabilityWeek(headers: Headers, rawWeek: unknown): Promise<UnavailabilityWindowView[]> {
  const week = parseUnavailabilityWeek(rawWeek)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    // Capacity checks the role again; this check keeps a Driver from reading the settings row first.
    if (actor.role !== 'admin' && actor.role !== 'dispatcher')
      throw new TenantAccessError(403)
    const { timeZone } = await loadTenantSettings(transaction)
    return listUnavailabilityDuring(ports(transaction, actor.userId), actor.role, unavailabilityWeekRange(week, timeZone))
  })
}
