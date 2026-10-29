import { z } from 'zod'
import { billingDetailsFieldsSchema } from './billing-details'
import { clientKindSchema } from './client'
import { contactPersonAddedFieldsSchema, contactPersonChangedFieldsSchema } from './contact-person'
import { driverFieldSchema } from './driver'
import { invoicingSettingsFieldsSchema } from './invoicing-settings'
import { locationFieldSchema } from './location'
import { partnerChangedFieldsSchema, partnerCreatedFieldsSchema } from './partner'
import { RIDE_ASSIGNMENT_FIELDS, RIDE_VEHICLE_CHANGE_FIELDS, rideAssignmentFieldSchema, rideVehicleChangeFieldSchema } from './ride-assignment'
import { RIDE_HANDOFF_CLEAR_FIELDS, RIDE_HANDOFF_OPEN_FIELDS, RIDE_PARTNER_CHANGED_FIELDS, RIDE_TAKEN_BACK_FIELDS } from './ride-handoff'
import { rosterDateSchema } from './roster'
import { tenantRoleSchema } from './tenant-role'
import { ianaTimeZoneSchema, operationalDayStartHourSchema, storedTimeZoneSchema, waitMinutesSchema } from './tenant-settings'
import { TRANSFER_CORRECTION_FIELDS, TRANSFER_FIELDS, transferCorrectionFieldSchema, transferFieldSchema } from './transfer'
import { unavailabilityFieldSchema } from './unavailability'
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
  'member.invitation_revoked',
  'settings.airport_wait_changed',
  'settings.elsewhere_wait_changed',
  'settings.time_zone_changed',
  'settings.operational_day_start_changed',
  'client.created',
  'client.name_changed',
  'client.kind_changed',
  'driver.created',
  'driver.field_changed',
  'driver.archived',
  'driver.unarchived',
  'vehicle.created',
  'vehicle.field_changed',
  'vehicle.archived',
  'location.created',
  'location.field_changed',
  'location.archived',
  'transfer.created',
  'transfer.corrected',
  'ride.assigned',
  'ride.accepted',
  'ride.accepted_by_phone',
  'ride.returned_to_assigned',
  'ride.done',
  'ride.no_show',
  'ride.no_show_early',
  'ride.cancelled',
  'ride.declined',
  'ride.landing_recorded',
  'ride.vehicle_changed',
  'ride.cleared',
  'ride.reassigned',
  'ride.handed_off',
  'ride.partner_changed',
  'ride.taken_back',
  'roster.assigned',
  'roster.changed',
  'roster.cleared',
  'tenant.renamed',
  'tenant.suspended',
  'tenant.reactivated',
  'settings.transfer_duration_changed',
  'settings.relocation_gap_changed',
  'unavailability.added',
  'unavailability.changed',
  'unavailability.removed',
  'contact_person.added',
  'contact_person.changed',
  'contact_person.removed',
  'partner.created',
  'partner.changed',
  'partner.archived',
  'partner.restored',
  'client_note.saved',
  'billing_details.saved',
  'invoicing_settings.changed',
  'invoice.requested',
  'invoice.issued',
  'invoice.failed',
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
 * The invitee still has no user id. The invitation id is the link, so it
 * stays off the row (ADR-0014). The role is the only field.
 */
const memberInvitationRevoked = z.object({
  action: z.literal('member.invitation_revoked'),
  subjectUserId: z.null(),
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

/** The previous transfer duration and the next one, in minutes. No member is named. */
const settingsTransferDurationChanged = z.object({
  action: z.literal('settings.transfer_duration_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ from: waitMinutesSchema, to: waitMinutesSchema }),
})

/** The previous relocation gap and the next one, in minutes. No member is named. */
const settingsRelocationGapChanged = z.object({
  action: z.literal('settings.relocation_gap_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({ from: waitMinutesSchema, to: waitMinutesSchema }),
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
 * Archive and unarchive name the row and nothing else. The name, the phone,
 * and the email stay on `app.drivers`. A second call writes no row.
 */
const driverArchived = z.object({
  action: z.literal('driver.archived'),
  subjectUserId: z.null(),
  data: z.strictObject({
    driverId,
  }),
})

const driverUnarchived = z.object({
  action: z.literal('driver.unarchived'),
  subjectUserId: z.null(),
  data: z.strictObject({
    driverId,
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
 * a tabla, a Client reference, or a price would stay forever on a row that is never deleted. The Ride id
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
    // An extra vehicle names its main Transfer. An ordinary create omits
    // the key. The id is not a passenger count (ADR-0054).
    mainTransferId: z.uuid().optional(),
  }),
})

/*
 * A correction is not a member. The ids are the booking after the save.
 * `fields` names what changed. A guest name, a flight number, a note, a
 * tabla, a Client reference, or a price is not a key. A save that changes nothing appends nothing.
 * `subjectUserId` stays null. The actor is the office member.
 */
const transferCorrected = z.object({
  action: z.literal('transfer.corrected'),
  subjectUserId: z.null(),
  data: z.strictObject({
    transferId,
    rideId,
    clientId,
    startLocationId: locationId,
    endLocationId: locationId,
    fields: z.array(transferCorrectionFieldSchema).min(1).max(TRANSFER_CORRECTION_FIELDS.length),
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

/**
 * The only field name a landing-time change may store. The instant stays on
 * the Transfer. This row is never deleted, so the time itself is not a key.
 */
export const RIDE_LANDING_FIELDS = ['landingAt'] as const

export const rideLandingFieldSchema = z.enum(RIDE_LANDING_FIELDS)

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
 * A trip change returns an accepted Ride to assigned. The Driver and the
 * Vehicle stay on the Ride. `fields` is only `state`. A name, a phone, a
 * plate, a guest, or the must-accept value is not a key. The actor is the
 * office member who corrected the Transfer. `subjectUserId` stays null.
 */
const rideReturnedToAssigned = z.object({
  action: z.literal('ride.returned_to_assigned'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    fields: z.array(rideAcceptedFieldSchema).length(RIDE_ACCEPTED_FIELDS.length),
  }),
})

/*
 * Marking a Ride done is the state change. The Driver and the Vehicle stay.
 * `fields` is only `state`. A name, a plate, a guest, or the flag value is
 * not a key. The actor is the person who marked it done, Driver or office.
 * `subjectUserId` stays null.
 */
const rideDone = z.object({
  action: z.literal('ride.done'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    fields: z.array(rideAcceptedFieldSchema).length(RIDE_ACCEPTED_FIELDS.length),
  }),
})

/*
 * A No-show after the wait is the state change. The Driver and the Vehicle
 * stay. `fields` is only `state`. A name, a plate, a guest, a fee, a charge,
 * or the flag value is not a key. The actor is the person who marked it,
 * Driver or office. `subjectUserId` stays null. An early office No-show is
 * a different action so the log can tell them apart.
 */
const rideNoShowData = z.strictObject({
  rideId,
  driverId,
  fields: z.array(rideAcceptedFieldSchema).length(RIDE_ACCEPTED_FIELDS.length),
})

const rideNoShow = z.object({
  action: z.literal('ride.no_show'),
  subjectUserId: z.null(),
  data: rideNoShowData,
})

const rideNoShowEarly = z.object({
  action: z.literal('ride.no_show_early'),
  subjectUserId: z.null(),
  data: rideNoShowData,
})

/*
 * Cancelling a Ride is the state change. The Driver and the Vehicle stay
 * on the Ride. `fields` is only `state`. `driverId` is null when the Ride
 * was unassigned. A name, a plate, a guest, or the flag value is not a key.
 * The actor is the office member who cancelled. `subjectUserId` stays null.
 */
const rideCancelled = z.object({
  action: z.literal('ride.cancelled'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId: driverId.nullable(),
    fields: z.array(rideAcceptedFieldSchema).length(RIDE_ACCEPTED_FIELDS.length),
  }),
})

/*
 * A decline returns the Ride to unassigned. The ids are the Driver who
 * declined and the Vehicle that was cleared. `fields` names what was
 * written. A name, a plate, a phone, a guest, or the must-accept value is
 * not a key. The actor is that Driver. `subjectUserId` stays null.
 */
const rideDeclined = z.object({
  action: z.literal('ride.declined'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    vehicleId,
    fields: z.array(rideAssignmentFieldSchema).length(RIDE_ASSIGNMENT_FIELDS.length),
  }),
})

/*
 * Recording or clearing a landing time does not move the Ride. `fields` is
 * only `landingAt`. `driverId` is null when the Ride was unassigned. The
 * instant stays on the Transfer: this row is never deleted. A name, a phone,
 * a plate, or a guest is not a key. The actor is the person who changed it.
 * `subjectUserId` stays null.
 */
const rideLandingRecorded = z.object({
  action: z.literal('ride.landing_recorded'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId: driverId.nullable(),
    fields: z.array(rideLandingFieldSchema).length(RIDE_LANDING_FIELDS.length),
  }),
})

/*
 * A vehicle-only change keeps the Driver. The ids say which Ride, which
 * Driver stayed, and which Vehicle is now on it. `fields` is only
 * `vehicleId`: the state and the copied flag did not change. A plate, a
 * phone, or the flag value would sit forever on a row that is never deleted.
 */
const rideVehicleChanged = z.object({
  action: z.literal('ride.vehicle_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    vehicleId,
    fields: z.array(rideVehicleChangeFieldSchema).length(RIDE_VEHICLE_CHANGE_FIELDS.length),
  }),
})

/*
 * A clear returns the Ride to unassigned. The ids are the Driver and the
 * Vehicle that were removed. `fields` names what was written. A plate, a
 * phone, or the must-accept value is not a key. The actor is the entry's actor.
 */
const rideCleared = z.object({
  action: z.literal('ride.cleared'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    vehicleId,
    fields: z.array(rideAssignmentFieldSchema).length(RIDE_ASSIGNMENT_FIELDS.length),
  }),
})

/*
 * A reassignment names the new Driver and the Vehicle. The previous Driver
 * is not a key. `fields` names what was written. A plate, a phone, or the
 * must-accept value stays off the row. The actor is the entry's actor.
 */
const rideReassigned = z.object({
  action: z.literal('ride.reassigned'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    driverId,
    vehicleId,
    fields: z.array(rideAssignmentFieldSchema).length(RIDE_ASSIGNMENT_FIELDS.length),
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

/*
 * An unavailability window (ADR-0034) names the window and its Driver, its
 * Vehicle, or its Partner; exactly one id is set and the other two are null.
 * `fields` names what was written. The instants are never a key, so the log
 * shows that a window changed, not when someone was away. A window has no
 * reason to log.
 */
function unavailabilityData<F extends z.ZodType>(fields: F) {
  return z.strictObject({
    windowId: z.uuid(),
    driverId: driverId.nullable(),
    vehicleId: vehicleId.nullable(),
    partnerId: z.uuid().nullable(),
    fields,
  }).refine(data => [data.driverId, data.vehicleId, data.partnerId].filter(id => id !== null).length === 1, {
    message: 'Exactly one of driverId, vehicleId, and partnerId is set.',
  })
}

const windowTimeField = unavailabilityFieldSchema.extract(['startsAt', 'endsAt'])

const unavailabilityAdded = z.object({
  action: z.literal('unavailability.added'),
  subjectUserId: z.null(),
  data: unavailabilityData(z.tuple([z.literal('startsAt'), z.literal('endsAt')])),
})

const unavailabilityChanged = z.object({
  action: z.literal('unavailability.changed'),
  subjectUserId: z.null(),
  data: unavailabilityData(z.array(windowTimeField).min(1).max(2).refine(fields => new Set(fields).size === fields.length)),
})

const unavailabilityRemoved = z.object({
  action: z.literal('unavailability.removed'),
  subjectUserId: z.null(),
  data: unavailabilityData(z.tuple([z.literal('removed')])),
})

/*
 * A contact person (ADR-0049) names the Client and the contact person, and
 * the fields that were written. The name, the role, the phone, and the email
 * stay on the contact row. A removed person records that it was removed.
 */
const contactPersonData = {
  clientId,
  contactPersonId: z.uuid(),
}

const contactPersonAdded = z.object({
  action: z.literal('contact_person.added'),
  subjectUserId: z.null(),
  data: z.strictObject({
    ...contactPersonData,
    fields: contactPersonAddedFieldsSchema,
  }),
})

const contactPersonChanged = z.object({
  action: z.literal('contact_person.changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    ...contactPersonData,
    fields: contactPersonChangedFieldsSchema,
  }),
})

const contactPersonRemoved = z.object({
  action: z.literal('contact_person.removed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    ...contactPersonData,
    fields: z.tuple([z.literal('removed')]),
  }),
})

/*
 * A Partner is not a member (ADR-0049). The id says which row. The data
 * names the fields that were written and nothing else: a name, a phone,
 * an email, or a note would stay forever on a row that is never deleted.
 * Archive and restore name the row and nothing else.
 */
const partnerId = z.uuid()

const partnerCreated = z.object({
  action: z.literal('partner.created'),
  subjectUserId: z.null(),
  data: z.strictObject({
    partnerId,
    fields: partnerCreatedFieldsSchema,
  }),
})

const partnerChanged = z.object({
  action: z.literal('partner.changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    partnerId,
    fields: partnerChangedFieldsSchema,
  }),
})

const partnerArchived = z.object({
  action: z.literal('partner.archived'),
  subjectUserId: z.null(),
  data: z.strictObject({
    partnerId,
  }),
})

const partnerRestored = z.object({
  action: z.literal('partner.restored'),
  subjectUserId: z.null(),
  data: z.strictObject({
    partnerId,
  }),
})

/*
 * A Client note (ADR-0049) names the Client and the field. The text stays
 * on the note row. One field, always `note`, so a clear and a correction
 * record the same array.
 */
const clientNoteSaved = z.object({
  action: z.literal('client_note.saved'),
  subjectUserId: z.null(),
  data: z.strictObject({
    clientId,
    fields: z.tuple([z.literal('note')]),
  }),
})

/*
 * Billing details (ADR-0051) name the Client and the fields that changed.
 * A legal name, an OIB, a VAT id, an address, or a guest name is not a value
 * on the row. The field order is the constant in billing-details.ts.
 */
const billingDetailsSaved = z.object({
  action: z.literal('billing_details.saved'),
  subjectUserId: z.null(),
  data: z.strictObject({
    clientId,
    fields: billingDetailsFieldsSchema,
  }),
})

/*
 * An invoicing settings change (ADR-0051) records the field names only.
 * The token is the field name `token`. Due days, the VAT rate, the line
 * text, and the token value are not on the row.
 */
const invoicingSettingsChanged = z.object({
  action: z.literal('invoicing_settings.changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    fields: invoicingSettingsFieldsSchema,
  }),
})

/*
 * An invoice (ADR-0051) names the invoice and the Transfer reference.
 * The number, the amount, the link, the guest, and the OIB are not keys.
 * The actor is the member who asked. `subjectUserId` stays null.
 */
const invoiceAuditData = z.strictObject({
  invoiceId: z.uuid(),
  transferId: z.uuid(),
})

function invoiceAudit(action: 'invoice.requested' | 'invoice.issued' | 'invoice.failed') {
  return z.object({
    action: z.literal(action),
    subjectUserId: z.null(),
    data: invoiceAuditData,
  })
}

const invoiceRequested = invoiceAudit('invoice.requested')
const invoiceIssued = invoiceAudit('invoice.issued')
const invoiceFailed = invoiceAudit('invoice.failed')

/*
 * A handoff names the Ride and the Partner. When it cleared a Driver, it
 * also names that Driver and the Vehicle. The field order is the constant
 * in ride-handoff.ts. A name, a contact, a plate, or a guest is not a key
 * (ADR-0048). `subjectUserId` stays null.
 */
const rideHandedOff = z.object({
  action: z.literal('ride.handed_off'),
  subjectUserId: z.null(),
  data: z.union([
    z.strictObject({
      rideId,
      partnerId,
      fields: z.tuple([z.literal(RIDE_HANDOFF_OPEN_FIELDS[0]), z.literal(RIDE_HANDOFF_OPEN_FIELDS[1])]),
    }),
    z.strictObject({
      rideId,
      partnerId,
      driverId,
      vehicleId,
      fields: z.tuple([
        z.literal(RIDE_HANDOFF_CLEAR_FIELDS[0]),
        z.literal(RIDE_HANDOFF_CLEAR_FIELDS[1]),
        z.literal(RIDE_HANDOFF_CLEAR_FIELDS[2]),
        z.literal(RIDE_HANDOFF_CLEAR_FIELDS[3]),
        z.literal(RIDE_HANDOFF_CLEAR_FIELDS[4]),
      ]),
    }),
  ]),
})

/** A Partner change names the new Partner. The previous Partner is not a key. */
const ridePartnerChanged = z.object({
  action: z.literal('ride.partner_changed'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    partnerId,
    fields: z.tuple([z.literal(RIDE_PARTNER_CHANGED_FIELDS[0])]),
  }),
})

/** Taking a handoff back names the Partner that was cleared. */
const rideTakenBack = z.object({
  action: z.literal('ride.taken_back'),
  subjectUserId: z.null(),
  data: z.strictObject({
    rideId,
    partnerId,
    fields: z.tuple([z.literal(RIDE_TAKEN_BACK_FIELDS[0]), z.literal(RIDE_TAKEN_BACK_FIELDS[1])]),
  }),
})

/** What happened: the action, the member it was done to, and its data. */
export const auditFactSchema = z.discriminatedUnion('action', [
  memberInvited,
  memberRoleChanged,
  memberRemoved,
  memberInvitationRevoked,
  settingsAirportWaitChanged,
  settingsElsewhereWaitChanged,
  settingsTimeZoneChanged,
  settingsOperationalDayStartChanged,
  clientCreated,
  clientNameChanged,
  clientKindChanged,
  driverCreated,
  driverFieldChanged,
  driverArchived,
  driverUnarchived,
  vehicleCreated,
  vehicleFieldChanged,
  vehicleArchived,
  locationCreated,
  locationFieldChanged,
  locationArchived,
  transferCreated,
  transferCorrected,
  rideAssigned,
  rideAccepted,
  rideAcceptedByPhone,
  rideReturnedToAssigned,
  rideDone,
  rideNoShow,
  rideNoShowEarly,
  rideCancelled,
  rideDeclined,
  rideLandingRecorded,
  rideVehicleChanged,
  rideCleared,
  rideReassigned,
  rideHandedOff,
  ridePartnerChanged,
  rideTakenBack,
  rosterAssigned,
  rosterChanged,
  rosterCleared,
  tenantRenamed,
  tenantSuspended,
  tenantReactivated,
  settingsTransferDurationChanged,
  settingsRelocationGapChanged,
  unavailabilityAdded,
  unavailabilityChanged,
  unavailabilityRemoved,
  contactPersonAdded,
  contactPersonChanged,
  contactPersonRemoved,
  partnerCreated,
  partnerChanged,
  partnerArchived,
  partnerRestored,
  clientNoteSaved,
  billingDetailsSaved,
  invoicingSettingsChanged,
  invoiceRequested,
  invoiceIssued,
  invoiceFailed,
])

export type AuditFact = z.infer<typeof auditFactSchema>

/**
 * GET /api/audit-entries, newest first. Names come from the Tenant's current
 * members; a person who is no longer a member has a null name.
 * `ride.assigned` also carries the current Driver name and Vehicle plate.
 * `ride.accepted` carries the Driver name only. The plate is not joined.
 * `ride.accepted_by_phone` carries neither. The actor name is the office member.
 * A member who has left has a null actor name. The plate is not joined.
 * `ride.done` carries the Driver name. The actor name is the person who
 * marked it done. The plate is not joined.
 * `ride.no_show` carries the Driver name. The actor is the person who
 * marked the No-show after the wait. The plate is not joined.
 * `ride.no_show_early` carries the Driver name. The actor is the office
 * member who marked it before the wait. The plate is not joined.
 * `ride.cancelled` carries the Driver name when the Ride had a Driver.
 * An unassigned cancel has a null Driver name. The actor name is the
 * person who cancelled. The plate is not joined.
 * `ride.declined` carries the Driver name and the Vehicle plate. The actor
 * is the Driver who declined. The ids are the ones that were cleared.
 * `ride.landing_recorded` carries the Driver name when the Ride had a Driver.
 * An unassigned change has a null Driver name. The actor name is the person
 * who recorded or cleared the landing time. The instant and the plate are not joined.
 * `ride.vehicle_changed`, `ride.cleared`, and `ride.reassigned` carry the
 * Driver name and the Vehicle plate, joined from the ids on the row.
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
  memberInvitationRevoked.extend(listed),
  settingsAirportWaitChanged.extend(listed),
  settingsElsewhereWaitChanged.extend(listed),
  settingsTimeZoneChanged.extend(listed),
  settingsOperationalDayStartChanged.extend(listed),
  clientCreated.extend(listed),
  clientNameChanged.extend(listed),
  clientKindChanged.extend(listed),
  driverCreated.extend(listed),
  driverFieldChanged.extend(listed),
  driverArchived.extend(listed),
  driverUnarchived.extend(listed),
  vehicleCreated.extend(listed),
  vehicleFieldChanged.extend(listed),
  vehicleArchived.extend(listed),
  locationCreated.extend(listed),
  locationFieldChanged.extend(listed),
  locationArchived.extend(listed),
  transferCreated.extend(listed),
  transferCorrected.extend(listed),
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
  rideReturnedToAssigned.extend({
    ...listed,
    // The Driver name is joined from `driverId`. The actor is the office member.
    driverName: z.string().nullable(),
  }),
  // The office member is `actorName`. A plate or a Driver name is not joined.
  rideAcceptedByPhone.extend(listed),
  rideDone.extend({
    ...listed,
    // The Driver name is joined from `driverId`. The person is `actorName`.
    driverName: z.string().nullable(),
  }),
  rideNoShow.extend({
    ...listed,
    // The Driver name is joined from `driverId`. The person is `actorName`.
    driverName: z.string().nullable(),
  }),
  rideNoShowEarly.extend({
    ...listed,
    // The Driver name is joined from `driverId`. The person is the office member.
    driverName: z.string().nullable(),
  }),
  rideCancelled.extend({
    ...listed,
    // The Driver name is joined when the Ride had a Driver. The person is `actorName`.
    driverName: z.string().nullable(),
  }),
  rideDeclined.extend({
    ...listed,
    // The Driver who declined, and the plate that was cleared. Both are joined.
    driverName: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
  }),
  rideLandingRecorded.extend({
    ...listed,
    // The Driver name is joined when the Ride had a Driver. The person is `actorName`.
    driverName: z.string().nullable(),
  }),
  rideVehicleChanged.extend({
    ...listed,
    driverName: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
  }),
  rideCleared.extend({
    ...listed,
    driverName: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
  }),
  rideReassigned.extend({
    ...listed,
    driverName: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
  }),
  rideHandedOff.extend({
    ...listed,
    // The cleared Driver and Vehicle, when the handoff had any. A Partner name is not joined.
    driverName: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
  }),
  ridePartnerChanged.extend(listed),
  rideTakenBack.extend(listed),
  rosterAssigned.extend(listed),
  rosterChanged.extend(listed),
  rosterCleared.extend(listed),
  tenantRenamed.extend(listed),
  tenantSuspended.extend(listed),
  tenantReactivated.extend(listed),
  settingsTransferDurationChanged.extend(listed),
  settingsRelocationGapChanged.extend(listed),
  unavailabilityAdded.extend(listed),
  unavailabilityChanged.extend(listed),
  unavailabilityRemoved.extend(listed),
  contactPersonAdded.extend(listed),
  contactPersonChanged.extend(listed),
  contactPersonRemoved.extend(listed),
  partnerCreated.extend(listed),
  partnerChanged.extend(listed),
  partnerArchived.extend(listed),
  partnerRestored.extend(listed),
  clientNoteSaved.extend(listed),
  billingDetailsSaved.extend(listed),
  invoicingSettingsChanged.extend(listed),
  invoiceRequested.extend(listed),
  invoiceIssued.extend(listed),
  invoiceFailed.extend(listed),
])

export type AuditEntry = z.infer<typeof auditEntrySchema>

export const auditEntryListSchema = z.object({
  entries: z.array(auditEntrySchema),
})

export type AuditEntryList = z.infer<typeof auditEntryListSchema>
