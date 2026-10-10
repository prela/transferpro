import { z } from 'zod'
import { clientKindSchema } from './client'
import { driverFieldSchema } from './driver'
import { locationFieldSchema } from './location'
import { RIDE_ASSIGNMENT_FIELDS, rideAssignmentFieldSchema } from './ride-assignment'
import { rosterDateSchema } from './roster'
import { tenantRoleSchema } from './tenant-role'
import { ianaTimeZoneSchema, operationalDayStartHourSchema, storedTimeZoneSchema, waitMinutesSchema } from './tenant-settings'
import { TRANSFER_FIELDS, transferFieldSchema } from './transfer'
import { vehicleFieldSchema } from './vehicle'

/**
 * Every action the audit log records (ADR-0014). The database enum
 * `app.audit_action` is declared from this list, so a new action also needs
 * a migration that adds the value.
 */
export const auditActions = [
  'member.invited',
  'member.role_changed',
  'member.removed',
  'settings.airport_wait_changed',
  'settings.elsewhere_wait_changed',
  'settings.time_zone_changed',
  'settings.operational_day_start_changed',
  'client.created',
  'client.name_changed',
  'client.kind_changed',
  'driver.created',
  'driver.field_changed',
  'vehicle.created',
  'vehicle.field_changed',
  'vehicle.archived',
  'location.created',
  'location.field_changed',
  'location.archived',
  'transfer.created',
  'ride.assigned',
  'ride.accepted',
  'ride.accepted_by_phone',
  'roster.assigned',
  'roster.changed',
  'roster.cleared',
  'tenant.renamed',
  'tenant.suspended',
  'tenant.reactivated',
] as const

export const auditActionSchema = z.enum(auditActions)

export type AuditAction = z.infer<typeof auditActionSchema>

const userId = z.string().min(1)

/*
 * Data objects are strict: the row is never deleted, so a name or an email
 * must not ride along in it. The invitee has no user id yet, so an invite
 * names no member.
 */
const memberInvited = z.object({
  action: z.literal('member.invited'),
  subjectUserId: z.null(),
  data: z.strictObject({ role: tenantRoleSchema }),
})

const memberRoleChanged = z.object({
  action: z.literal('member.role_changed'),
  subjectUserId: userId,
  data: z.strictObject({ from: tenantRoleSchema, to: tenantRoleSchema }),
})

const memberRemoved = z.object({
  action: z.literal('member.removed'),
  subjectUserId: userId,
  data: z.strictObject({ role: tenantRoleSchema }),
})

/*
 * A settings change names no member. `from` and `to` are the only values,
 * so a name or an email cannot be stored on a row that is never deleted.
 * The previous zone is the stored text. The next zone has to be on the
 * current list, so a name that has left the list can still be recorded
 * as what the row used to say.
 */
const settingsAirportWaitChanged = z.object({
  action: z.literal('settings.airport_wait_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ from: waitMinutesSchema, to: waitMinutesSchema }),
})

const settingsElsewhereWaitChanged = z.object({
  action: z.literal('settings.elsewhere_wait_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ from: waitMinutesSchema, to: waitMinutesSchema }),
})

const settingsTimeZoneChanged = z.object({
  action: z.literal('settings.time_zone_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ from: storedTimeZoneSchema, to: ianaTimeZoneSchema }),
})

/** The previous hour and the next hour. No member is named. */
const settingsOperationalDayStartChanged = z.object({
  action: z.literal('settings.operational_day_start_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ from: operationalDayStartHourSchema, to: operationalDayStartHourSchema }),
})

/*
 * A Client is not a member. The id says which row. The name stays on
 * `app.clients` (ADR-0017): an individual Client is a person, and this
 * row is never deleted. Kind is not a name, so a kind change keeps from/to.
 */
const clientId = z.uuid()

const clientCreated = z.object({
  action: z.literal('client.created'),
  subjectUserId: z.null(),
  data: z.strictObject({ clientId, kind: clientKindSchema }),
})

const clientNameChanged = z.object({
  action: z.literal('client.name_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ clientId }),
})

const clientKindChanged = z.object({
  action: z.literal('client.kind_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ clientId, from: clientKindSchema, to: clientKindSchema }),
})

/*
 * A Driver is not a member. The id says which row. The data names the
 * fields that were written and nothing else: a phone or a licence date
 * would stay forever on a row that is never deleted.
 */
const driverId = z.uuid()

const driverCreated = z.object({
  action: z.literal('driver.created'),
  subjectUserId: z.null(),
  data: z.strictObject({
    driverId,
    fields: z.array(driverFieldSchema).min(1),
  }),
})

const driverFieldChanged = z.object({
  action: z.literal('driver.field_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    driverId,
    field: driverFieldSchema,
  }),
})

/*
 * A Vehicle is not a member. The id says which row. The data names the
 * fields that were written and nothing else: a plate or an expiry date
 * would stay forever on a row that is never deleted.
 */
const vehicleId = z.uuid()

const vehicleCreated = z.object({
  action: z.literal('vehicle.created'),
  subjectUserId: z.null(),
  data: z.strictObject({
    vehicleId,
    fields: z.array(vehicleFieldSchema).min(1),
  }),
})

const vehicleFieldChanged = z.object({
  action: z.literal('vehicle.field_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    vehicleId,
    field: vehicleFieldSchema,
  }),
})

const vehicleArchived = z.object({
  action: z.literal('vehicle.archived'),
  subjectUserId: z.null(),
  data: z.strictObject({
    vehicleId,
  }),
})

/*
 * A Location is not a member. The id says which row. The data names the
 * fields that were written and nothing else: a name or an address would
 * stay forever on a row that is never deleted.
 */
const locationId = z.uuid()

const locationCreated = z.object({
  action: z.literal('location.created'),
  subjectUserId: z.null(),
  data: z.strictObject({
    locationId,
    fields: z.array(locationFieldSchema).min(1),
  }),
})

const locationFieldChanged = z.object({
  action: z.literal('location.field_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    locationId,
    field: locationFieldSchema,
  }),
})

const locationArchived = z.object({
  action: z.literal('location.archived'),
  subjectUserId: z.null(),
  data: z.strictObject({
    locationId,
  }),
})

/*
 * A Transfer is not a member. The ids say which rows. The field list names
 * what was written and nothing else: a guest name, a flight number, a note,
 * or a price would stay forever on a row that is never deleted. The Ride id
 * is here because creating the Transfer creates that one Ride.
 */
const transferId = z.uuid()
const rideId = z.uuid()

const transferCreated = z.object({
  action: z.literal('transfer.created'),
  subjectUserId: z.null(),
  data: z.strictObject({
    transferId,
    rideId,
    clientId,
    startLocationId: locationId,
    endLocationId: locationId,
    fields: z.array(transferFieldSchema).min(1).max(TRANSFER_FIELDS.length),
  }),
})

/*
 * An assignment is not a member. The ids say which rows. The field list
 * names what was written. The must-accept value stays on the Ride: a boolean
 * copied from the Driver would still be a value, and this row is never deleted.
 * A plate, a phone, or a name is not a key. The actor is the entry's actor, not a field.
 */
const rideAssigned = z.object({
  action: z.literal('ride.assigned'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    vehicleId,
    fields: z.array(rideAssignmentFieldSchema).min(1).max(RIDE_ASSIGNMENT_FIELDS.length),
  }),
})

/**
 * The only field name an acceptance may store. The Driver, the Vehicle, and
 * the copied flag stay on the Ride. A name, a phone, a plate, or the flag
 * value would sit forever on a row that is never deleted.
 */
export const RIDE_ACCEPTED_FIELDS = ['state'] as const

export const rideAcceptedFieldSchema = z.enum(RIDE_ACCEPTED_FIELDS)

/*
 * An acceptance is not a member. The ids say which Ride and which Driver.
 * `fields` is only `state`: the transition is the state change. The actor
 * is the entry's actor. `subjectUserId` stays null.
 */
const rideAccepted = z.object({
  action: z.literal('ride.accepted'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    fields: z.array(rideAcceptedFieldSchema).length(RIDE_ACCEPTED_FIELDS.length),
  }),
})

/*
 * The office records that the Driver accepted by phone. The action name is
 * the fact; the phone number is not a key, because this row is never deleted.
 * The ids say which Ride and which Driver. `fields` is only `state`. A name,
 * a plate, a guest, or the must-accept value stays off the row. The actor is
 * the office member. `subjectUserId` stays null.
 */
const rideAcceptedByPhone = z.object({
  action: z.literal('ride.accepted_by_phone'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    fields: z.array(rideAcceptedFieldSchema).length(RIDE_ACCEPTED_FIELDS.length),
  }),
})

/*
 * A roster row is not a member. The data names the day and the ids.
 * A plate, a driver name, or a phone would stay forever on a row that
 * is never deleted, so none of those keys exist.
 */
const rosterAssigned = z.object({
  action: z.literal('roster.assigned'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rosterDate: rosterDateSchema,
    driverId,
    vehicleId,
  }),
})

const rosterChanged = z.object({
  action: z.literal('roster.changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rosterDate: rosterDateSchema,
    driverId,
    fromVehicleId: vehicleId,
    toVehicleId: vehicleId,
  }),
})

const rosterCleared = z.object({
  action: z.literal('roster.cleared'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rosterDate: rosterDateSchema,
    driverId,
    vehicleId,
  }),
})

/*
 * A platform mutation names no person and stores no company name.
 * The organization id is the row's tenant_id. `data` stays empty.
 */
function tenantPlatformAction(action: 'tenant.renamed' | 'tenant.suspended' | 'tenant.reactivated') {
  return z.object({
    action: z.literal(action),
    subjectUserId: z.null(),
    data: z.strictObject({}),
  })
}

const tenantRenamed = tenantPlatformAction('tenant.renamed')
const tenantSuspended = tenantPlatformAction('tenant.suspended')
const tenantReactivated = tenantPlatformAction('tenant.reactivated')

/** What happened: the action, the member it was done to, and its data. */
export const auditFactSchema = z.discriminatedUnion('action', [
  memberInvited,
  memberRoleChanged,
  memberRemoved,
  settingsAirportWaitChanged,
  settingsElsewhereWaitChanged,
  settingsTimeZoneChanged,
  settingsOperationalDayStartChanged,
  clientCreated,
  clientNameChanged,
  clientKindChanged,
  driverCreated,
  driverFieldChanged,
  vehicleCreated,
  vehicleFieldChanged,
  vehicleArchived,
  locationCreated,
  locationFieldChanged,
  locationArchived,
  transferCreated,
  rideAssigned,
  rideAccepted,
  rideAcceptedByPhone,
  rosterAssigned,
  rosterChanged,
  rosterCleared,
  tenantRenamed,
  tenantSuspended,
  tenantReactivated,
])

export type AuditFact = z.infer<typeof auditFactSchema>

/**
 * GET /api/audit-entries, newest first. Names come from the Tenant's current
 * members; a person who is no longer a member has a null name.
 * `ride.assigned` also carries the current Driver name and Vehicle plate.
 * `ride.accepted` carries the Driver name only. The plate is not joined.
 * `ride.accepted_by_phone` carries neither. The actor name is the office member.
 * A member who has left has a null actor name. The plate is not joined.
 */
const listed = {
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  actorUserId: userId,
  actorName: z.string().nullable(),
  subjectName: z.string().nullable(),
}

export const auditEntrySchema = z.discriminatedUnion('action', [
  memberInvited.extend(listed),
  memberRoleChanged.extend(listed),
  memberRemoved.extend(listed),
  settingsAirportWaitChanged.extend(listed),
  settingsElsewhereWaitChanged.extend(listed),
  settingsTimeZoneChanged.extend(listed),
  settingsOperationalDayStartChanged.extend(listed),
  clientCreated.extend(listed),
  clientNameChanged.extend(listed),
  clientKindChanged.extend(listed),
  driverCreated.extend(listed),
  driverFieldChanged.extend(listed),
  vehicleCreated.extend(listed),
  vehicleFieldChanged.extend(listed),
  vehicleArchived.extend(listed),
  locationCreated.extend(listed),
  locationFieldChanged.extend(listed),
  locationArchived.extend(listed),
  transferCreated.extend(listed),
  rideAssigned.extend({
    ...listed,
    // Resolved at read time. The stored data keeps ids only (ADR-0014).
    driverName: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
  }),
  rideAccepted.extend({
    ...listed,
    // The Driver name is joined from `driverId`. The plate is not.
    driverName: z.string().nullable(),
  }),
  // The office member is `actorName`. A plate or a Driver name is not joined.
  rideAcceptedByPhone.extend(listed),
  rosterAssigned.extend(listed),
  rosterChanged.extend(listed),
  rosterCleared.extend(listed),
  tenantRenamed.extend(listed),
  tenantSuspended.extend(listed),
  tenantReactivated.extend(listed),
])

export type AuditEntry = z.infer<typeof auditEntrySchema>

export const auditEntryListSchema = z.object({
  entries: z.array(auditEntrySchema),
})

export type AuditEntryList = z.infer<typeof auditEntryListSchema>
