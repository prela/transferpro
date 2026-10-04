import { z } from 'zod'
import { tenantRoleSchema } from './tenant-role'
import { ianaTimeZoneSchema, storedTimeZoneSchema, waitMinutesSchema } from './tenant-settings'

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

/** What happened: the action, the member it was done to, and its data. */
export const auditFactSchema = z.discriminatedUnion('action', [
  memberInvited,
  memberRoleChanged,
  memberRemoved,
  settingsAirportWaitChanged,
  settingsElsewhereWaitChanged,
  settingsTimeZoneChanged,
])

export type AuditFact = z.infer<typeof auditFactSchema>

/**
 * GET /api/audit-entries, newest first. Names come from the Tenant's current
 * members; a person who is no longer a member has a null name.
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
])

export type AuditEntry = z.infer<typeof auditEntrySchema>

export const auditEntryListSchema = z.object({
  entries: z.array(auditEntrySchema),
})

export type AuditEntryList = z.infer<typeof auditEntryListSchema>
