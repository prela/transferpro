import { expect, it } from 'vitest'
import { auditActions, auditEntryListSchema, auditFactSchema } from './audit-entry'

const memberId = '6b1e0c3a-2222-4222-8222-222222222222'
const adminId = '7c2f1d4b-3333-4333-8333-333333333333'

it('gives every audit action exactly one entry shape', () => {
  const shapes = auditFactSchema.options.map(option => option.shape.action.value)
  expect(shapes).toEqual([...auditActions])
})

it('records a role change as from and to, and refuses any other data key', () => {
  const change = { action: 'member.role_changed', subjectUserId: memberId, data: { from: 'driver', to: 'dispatcher' } }
  expect(auditFactSchema.parse(change)).toEqual(change)
  // An extra key is how an email or a name would slip into an append-only row.
  expect(auditFactSchema.safeParse({ ...change, data: { ...change.data, email: 'ana@example.com' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...change, data: { from: 'owner', to: 'driver' } }).success).toBe(false)
})

it('names no member on an invite and names the member on a removal', () => {
  expect(auditFactSchema.safeParse({ action: 'member.invited', subjectUserId: null, data: { role: 'driver' } }).success).toBe(true)
  expect(auditFactSchema.safeParse({ action: 'member.invited', subjectUserId: memberId, data: { role: 'driver' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ action: 'member.removed', subjectUserId: memberId, data: { role: 'admin' } }).success).toBe(true)
  expect(auditFactSchema.safeParse({ action: 'member.removed', subjectUserId: null, data: { role: 'admin' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ action: 'member.left', subjectUserId: memberId, data: {} }).success).toBe(false)
})

it('records a wait or a time zone as from and to, and refuses a member, a name, or an email', () => {
  const wait = { action: 'settings.airport_wait_changed' as const, subjectUserId: null, data: { from: 90, to: 120 } }
  expect(auditFactSchema.parse(wait)).toEqual(wait)
  expect(auditFactSchema.safeParse({ ...wait, subjectUserId: memberId }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...wait, data: { from: 90, to: 120, email: 'ana@example.com' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...wait, data: { from: 0, to: 90 } }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    action: 'settings.elsewhere_wait_changed',
    subjectUserId: null,
    data: { from: 25, to: 30 },
  }).success).toBe(true)
  const zone = {
    action: 'settings.time_zone_changed' as const,
    subjectUserId: null,
    data: { from: 'Europe/Zagreb', to: 'Europe/Berlin' },
  }
  expect(auditFactSchema.parse(zone)).toEqual(zone)
  expect(auditFactSchema.safeParse({ ...zone, data: { from: 'Europe/Zagreb', to: 'Not/AZone' } }).success).toBe(false)
  expect(auditEntryListSchema.safeParse({
    entries: [{
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurredAt: '2026-10-03T18:42:00.000Z',
      actorUserId: adminId,
      actorName: 'Ana Admin',
      subjectName: null,
      ...wait,
    }],
  }).success).toBe(true)
})

it('records a Client by id and kind, and refuses the name', () => {
  const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
  const created = {
    action: 'client.created' as const,
    subjectUserId: null,
    data: { clientId, kind: 'agency' as const },
  }
  expect(auditFactSchema.parse(created)).toEqual(created)
  expect(auditFactSchema.safeParse({ ...created, data: { ...created.data, name: 'Agencija Mora' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, subjectUserId: memberId }).success).toBe(false)

  const renamed = { action: 'client.name_changed' as const, subjectUserId: null, data: { clientId } }
  expect(auditFactSchema.parse(renamed)).toEqual(renamed)
  expect(auditFactSchema.safeParse({
    ...renamed,
    data: { clientId, from: 'Mora', to: 'Mora d.o.o.' },
  }).success).toBe(false)

  const kind = {
    action: 'client.kind_changed' as const,
    subjectUserId: null,
    data: { clientId, from: 'hotel' as const, to: 'agency' as const },
  }
  expect(auditFactSchema.parse(kind)).toEqual(kind)
  expect(auditFactSchema.safeParse({ ...kind, data: { clientId, from: 'hotel', to: 'partner' } }).success).toBe(false)
})

it('records a Driver by id and field names, and refuses the phone and the dates', () => {
  const driverId = '9e4b3f6d-5555-4555-8555-555555555555'
  const phone = '+385911112222'
  const created = {
    action: 'driver.created' as const,
    subjectUserId: null,
    data: {
      driverId,
      fields: ['name', 'kind', 'phone', 'drivingLicenceExpiresOn', 'transportLicenceExpiresOn'] as const,
    },
  }
  expect(auditFactSchema.parse(created)).toEqual(created)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { ...created.data, phone },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { driverId, fields: ['phone'], drivingLicenceExpiresOn: '2027-06-01' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, subjectUserId: memberId }).success).toBe(false)

  const changed = {
    action: 'driver.field_changed' as const,
    subjectUserId: null,
    data: { driverId, field: 'phone' as const },
  }
  expect(auditFactSchema.parse(changed)).toEqual(changed)
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { driverId, field: 'phone', from: phone, to: '+385911110000' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { driverId, field: 'notes' },
  }).success).toBe(false)
})

it('records a Vehicle by id and field names, and refuses the plate and the dates', () => {
  const vehicleId = 'a1b2c3d4-5555-4555-8555-555555555555'
  const plate = 'DU123AB'
  const created = {
    action: 'vehicle.created' as const,
    subjectUserId: null,
    data: {
      vehicleId,
      fields: ['registrationPlate', 'kind', 'registrationExpiresOn', 'technicalInspectionExpiresOn', 'insuranceExpiresOn'] as const,
    },
  }
  expect(auditFactSchema.parse(created)).toEqual(created)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { ...created.data, registrationPlate: plate },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { vehicleId, fields: ['kind'], registrationExpiresOn: '2027-06-01' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, subjectUserId: memberId }).success).toBe(false)

  const changed = {
    action: 'vehicle.field_changed' as const,
    subjectUserId: null,
    data: { vehicleId, field: 'registrationPlate' as const },
  }
  expect(auditFactSchema.parse(changed)).toEqual(changed)
  expect(auditFactSchema.parse({
    action: 'vehicle.field_changed' as const,
    subjectUserId: null,
    data: { vehicleId, field: 'description' as const },
  }).data).toEqual({ vehicleId, field: 'description' })
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { vehicleId, field: 'description', from: 'van' },
  }).success).toBe(false)

  const archived = {
    action: 'vehicle.archived' as const,
    subjectUserId: null,
    data: { vehicleId },
  }
  expect(auditFactSchema.parse(archived)).toEqual(archived)
  expect(auditFactSchema.safeParse({
    ...archived,
    data: { vehicleId, registrationPlate: plate },
  }).success).toBe(false)
})

it('lists an entry whose people are no longer members with null names', () => {
  const listed = auditEntryListSchema.parse({
    entries: [{
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurredAt: '2026-10-03T18:42:00.000Z',
      actorUserId: adminId,
      actorName: null,
      action: 'member.removed',
      subjectUserId: memberId,
      subjectName: null,
      data: { role: 'driver' },
    }],
  })
  expect(listed.entries[0]?.actorName).toBeNull()
  expect(auditEntryListSchema.safeParse({
    entries: [{ ...listed.entries[0], occurredAt: 'yesterday' }],
  }).success).toBe(false)
})
