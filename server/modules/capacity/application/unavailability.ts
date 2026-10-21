import type {
  ChangeUnavailability,
  CoveredRide,
  RecordUnavailability,
  UnavailabilityResource,
  UnavailabilitySaved,
  UnavailabilityWindowView,
} from '../../../../shared'
import type { UnavailabilityWindow } from '../domain/unavailability'
import type { UnavailabilityPorts } from './ports'
import { TenantAccessError } from '../../tenancy'
import { UnavailabilityArchivedError, UnavailabilityNotFoundError } from '../domain/errors'
import { changedWindowFields, ridesCoveredBy } from '../domain/unavailability'

/*
 * The window commands (ADR-0034). Office only: a Dispatcher or an Admin.
 * Every write takes the Tenant capacity lock, so a window and an assignment
 * of the same Driver or Vehicle run one after the other. The order is:
 * role, the window row lock for a change or a removal, the Tenant lock,
 * and only then the Driver or Vehicle read. A refusal writes nothing and
 * audits nothing. The audit fact holds ids and field names, never instants.
 */

function officeOnly(role: string): void {
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
}

function ownerOf(window: UnavailabilityWindow): UnavailabilityResource {
  if (window.driverId !== null)
    return { kind: 'driver', id: window.driverId }
  if (window.vehicleId !== null)
    return { kind: 'vehicle', id: window.vehicleId }
  return { kind: 'partner', id: window.partnerId ?? '' }
}

/** A window may be added or moved only on an active Driver or Vehicle of this Tenant. */
async function requireActive(ports: UnavailabilityPorts, resource: UnavailabilityResource): Promise<void> {
  const presence = await ports.presence(resource)
  if (presence === 'missing')
    throw new UnavailabilityNotFoundError()
  if (presence === 'archived')
    throw new UnavailabilityArchivedError()
}

export function toWindowView(window: UnavailabilityWindow): UnavailabilityWindowView {
  return {
    id: window.id,
    driverId: window.driverId,
    vehicleId: window.vehicleId,
    partnerId: window.partnerId,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
  }
}

/**
 * The assigned, accepted, or handed-off Rides of the window's Driver,
 * Vehicle, or Partner whose occupied window it now covers. The save does
 * not refuse them; the office is told which Rides to move. The range starts
 * one transfer duration early, so a Ride whose pickup is before the window
 * and whose occupied window reaches into it is found; the domain then
 * judges each exactly. A handed-off Ride does not occupy its Partner, but
 * it is still listed when the window covers it.
 */
async function coveredRides(ports: UnavailabilityPorts, window: UnavailabilityWindow): Promise<CoveredRide[]> {
  const { transferDurationMinutes } = await ports.minutes()
  const rides = await ports.occupation.ridesDuring({
    of: {
      driverIds: window.driverId === null ? [] : [window.driverId],
      vehicleIds: window.vehicleId === null ? [] : [window.vehicleId],
      partnerIds: window.partnerId === null ? [] : [window.partnerId],
    },
    from: new Date(window.startsAt.getTime() - transferDurationMinutes * 60_000),
    to: window.endsAt,
  })
  return ridesCoveredBy(window, rides, transferDurationMinutes)
    .map(ride => ({ rideId: ride.rideId, pickupAt: ride.pickupAt.toISOString() }))
}

async function saved(ports: UnavailabilityPorts, window: UnavailabilityWindow): Promise<UnavailabilitySaved> {
  return { window: toWindowView(window), coveredRides: await coveredRides(ports, window) }
}

/** Add a window for one Driver or one Vehicle. Answers the window and the Rides it covers. */
export async function recordUnavailability(
  ports: UnavailabilityPorts,
  role: string,
  input: RecordUnavailability,
): Promise<UnavailabilitySaved> {
  officeOnly(role)
  await ports.lock()
  await requireActive(ports, input.resource)
  const window = await ports.store.insert({
    driverId: input.resource.kind === 'driver' ? input.resource.id : null,
    vehicleId: input.resource.kind === 'vehicle' ? input.resource.id : null,
    partnerId: input.resource.kind === 'partner' ? input.resource.id : null,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
  })
  await ports.audit({
    action: 'unavailability.added',
    windowId: window.id,
    driverId: window.driverId,
    vehicleId: window.vehicleId,
    partnerId: window.partnerId,
    fields: ['startsAt', 'endsAt'],
  })
  return saved(ports, window)
}

/**
 * Move a window's instants. A save that moves neither writes nothing and
 * audits nothing, and still answers the Rides the window covers.
 */
export async function changeUnavailability(
  ports: UnavailabilityPorts,
  role: string,
  input: ChangeUnavailability,
): Promise<UnavailabilitySaved> {
  officeOnly(role)
  const before = await ports.store.lockLive(input.windowId)
  if (!before)
    throw new UnavailabilityNotFoundError()
  await ports.lock()
  await requireActive(ports, ownerOf(before))
  const times = { startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) }
  const fields = changedWindowFields(before, times)
  if (fields.length === 0)
    return saved(ports, before)
  const after = await ports.store.update(before.id, times)
  await ports.audit({
    action: 'unavailability.changed',
    windowId: after.id,
    driverId: after.driverId,
    vehicleId: after.vehicleId,
    partnerId: after.partnerId,
    fields,
  })
  return saved(ports, after)
}

/**
 * Mark a window removed; it no longer counts. The row stays until the
 * retention job deletes it. A window of an archived Driver or Vehicle can
 * still be removed.
 */
export async function removeUnavailability(ports: UnavailabilityPorts, role: string, windowId: string): Promise<void> {
  officeOnly(role)
  const window = await ports.store.lockLive(windowId)
  if (!window)
    throw new UnavailabilityNotFoundError()
  await ports.lock()
  await ports.store.markRemoved(window.id)
  await ports.audit({
    action: 'unavailability.removed',
    windowId: window.id,
    driverId: window.driverId,
    vehicleId: window.vehicleId,
    partnerId: window.partnerId,
    fields: ['removed'],
  })
}

/** The live windows of one Driver or one Vehicle, archived or not. 404 when it is not in this Tenant. */
export async function listUnavailabilityOf(
  ports: UnavailabilityPorts,
  role: string,
  resource: UnavailabilityResource,
): Promise<UnavailabilityWindowView[]> {
  officeOnly(role)
  if (await ports.presence(resource) === 'missing')
    throw new UnavailabilityNotFoundError()
  return (await ports.store.liveOf(resource)).map(toWindowView)
}

/** The Tenant's live windows that share an instant with `[from, to)`, for the roster week grid. */
export async function listUnavailabilityDuring(
  ports: UnavailabilityPorts,
  role: string,
  range: { readonly from: Date, readonly to: Date },
): Promise<UnavailabilityWindowView[]> {
  officeOnly(role)
  return (await ports.store.liveDuring(range.from, range.to)).map(toWindowView)
}
