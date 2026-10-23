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
  expect(auditFactSchema.safeParse({ action: 'member.invitation_revoked', subjectUserId: null, data: { role: 'driver' } }).success).toBe(true)
  expect(auditFactSchema.safeParse({ action: 'member.invitation_revoked', subjectUserId: memberId, data: { role: 'driver' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ action: 'member.invitation_revoked', subjectUserId: null, data: { role: 'driver', email: 'ana@example.test' } }).success).toBe(false)
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
  const hour = {
    action: 'settings.operational_day_start_changed' as const,
    subjectUserId: null,
    data: { from: 5, to: 6 },
  }
  expect(auditFactSchema.parse(hour)).toEqual(hour)
  expect(auditFactSchema.safeParse({ ...hour, subjectUserId: memberId }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...hour, data: { from: 5, to: 6, email: 'ana@example.com' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...hour, data: { from: 5, to: 9 } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...hour, data: { from: 5.5, to: 6 } }).success).toBe(false)
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
  expect(auditFactSchema.parse({
    ...changed,
    data: { driverId, field: 'email' as const },
  }).data).toEqual({ driverId, field: 'email' })
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { driverId, field: 'email', email: 'marko@example.test' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { driverId, field: 'notes' },
  }).success).toBe(false)

  const archived = {
    action: 'driver.archived' as const,
    subjectUserId: null,
    data: { driverId },
  }
  expect(auditFactSchema.parse(archived)).toEqual(archived)
  expect(auditFactSchema.safeParse({
    ...archived,
    data: { driverId, name: 'Marko Marić' },
  }).success).toBe(false)
  expect(auditFactSchema.parse({
    action: 'driver.unarchived' as const,
    subjectUserId: null,
    data: { driverId },
  }).data).toEqual({ driverId })
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

it('records a Location by id and field names, and refuses the name and the address', () => {
  const locationId = 'd1d1d1d1-5555-4555-8555-555555555555'
  const place = 'Zračna luka Dubrovnik'
  const address = 'Dobrota bb, Čilipi'
  const created = {
    action: 'location.created' as const,
    subjectUserId: null,
    data: {
      locationId,
      fields: ['name', 'kind', 'address'] as const,
    },
  }
  expect(auditFactSchema.parse(created)).toEqual(created)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { ...created.data, name: place, address },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { locationId, fields: ['kind'], address },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, subjectUserId: memberId }).success).toBe(false)

  const changed = {
    action: 'location.field_changed' as const,
    subjectUserId: null,
    data: { locationId, field: 'address' as const },
  }
  expect(auditFactSchema.parse(changed)).toEqual(changed)
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { locationId, field: 'address', from: address, to: 'Nova adresa' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { locationId, field: 'notes' },
  }).success).toBe(false)

  const archived = {
    action: 'location.archived' as const,
    subjectUserId: null,
    data: { locationId },
  }
  expect(auditFactSchema.parse(archived)).toEqual(archived)
  expect(auditFactSchema.safeParse({
    ...archived,
    data: { locationId, name: place },
  }).success).toBe(false)
})

it('records a Transfer by ids and field names, and refuses the guest name, the flight, the note, and the price', () => {
  const transferId = 'd1d1d1d1-1111-4111-8111-111111111111'
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
  const startLocationId = 'a1b2c3d4-5555-4555-8555-555555555555'
  const endLocationId = 'b1b2c3d4-6666-4666-8666-666666666666'
  const created = {
    action: 'transfer.created' as const,
    subjectUserId: null,
    data: {
      transferId,
      rideId,
      clientId,
      startLocationId,
      endLocationId,
      fields: ['pickupAt', 'passengerCount', 'guestName', 'price', 'payment', 'airportMark', 'luggageCount', 'childSeatCount'] as const,
    },
  }
  expect(auditFactSchema.parse(created)).toEqual(created)
  const withTabla = {
    ...created,
    data: { ...created.data, fields: [...created.data.fields, 'tabla'] as const },
  }
  expect(auditFactSchema.parse(withTabla)).toEqual(withTabla)
  const withReference = {
    ...created,
    data: { ...created.data, fields: [...created.data.fields, 'clientReference'] as const },
  }
  expect(auditFactSchema.parse(withReference)).toEqual(withReference)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { ...created.data, guestName: 'Ana Anić', flightNumber: 'OU 384', note: 'terminal', tabla: 'GOSPOĐA HORVAT', clientReference: 'V-19', price: '42.50' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { ...created.data, fields: ['guestName', 'Ana Anić'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, subjectUserId: memberId }).success).toBe(false)
  const mainTransferId = 'd4d4d4d4-4444-4444-8444-444444444444'
  const linked = {
    ...created,
    data: { ...created.data, mainTransferId },
  }
  expect(auditFactSchema.parse(linked)).toEqual(linked)
  expect(auditFactSchema.safeParse({
    ...linked,
    data: { ...linked.data, mainTransferId: 'not-a-uuid' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...created,
    data: { ...created.data, groupPassengerCount: 80 },
  }).success).toBe(false)
})

it('records a correction by ids and changed field names, and a return to assigned by the Ride id and the Driver id', () => {
  const transferId = 'd1d1d1d1-1111-4111-8111-111111111111'
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
  const startLocationId = 'a1b2c3d4-5555-4555-8555-555555555555'
  const endLocationId = 'b1b2c3d4-6666-4666-8666-666666666666'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const corrected = {
    action: 'transfer.corrected' as const,
    subjectUserId: null,
    data: {
      transferId,
      rideId,
      clientId,
      startLocationId,
      endLocationId,
      fields: ['airportMark'] as const,
    },
  }
  expect(auditFactSchema.parse(corrected)).toEqual(corrected)
  expect(auditFactSchema.safeParse({
    ...corrected,
    data: { ...corrected.data, guestName: 'Ana Anić', flightNumber: 'OU 384', note: 'terminal', tabla: 'GOSPOĐA HORVAT', clientReference: 'V-19', price: '42.50' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...corrected,
    data: { ...corrected.data, fields: [] },
  }).success).toBe(false)
  const groupCount = {
    ...corrected,
    data: { ...corrected.data, fields: ['groupPassengerCount'] as const },
  }
  expect(auditFactSchema.parse(groupCount)).toEqual(groupCount)
  expect(auditFactSchema.safeParse({
    ...groupCount,
    data: { ...groupCount.data, groupPassengerCount: 80 },
  }).success).toBe(false)

  const returned = {
    action: 'ride.returned_to_assigned' as const,
    subjectUserId: null,
    data: { rideId, driverId, fields: ['state'] as const },
  }
  expect(auditFactSchema.parse(returned)).toEqual(returned)
  expect(auditFactSchema.safeParse({
    ...returned,
    data: { ...returned.data, guestName: 'Ana Anić', mustAccept: true },
  }).success).toBe(false)
})

it('records an assignment by ids and field names, and refuses a plate, a phone, or the must-accept value', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const assigned = {
    action: 'ride.assigned' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      vehicleId,
      fields: ['state', 'driverId', 'vehicleId', 'mustAccept'] as const,
    },
  }
  expect(auditFactSchema.parse(assigned)).toEqual(assigned)
  expect(auditFactSchema.safeParse({
    ...assigned,
    data: { ...assigned.data, registrationPlate: 'ZG1001AA', phone: '+38591111', mustAccept: true },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...assigned,
    data: { ...assigned.data, fields: ['mustAccept', 'true'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...assigned, subjectUserId: memberId }).success).toBe(false)
})

it('records an acceptance by the Ride id, the Driver id, and the field name state', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const accepted = {
    action: 'ride.accepted' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      fields: ['state'] as const,
    },
  }
  expect(auditFactSchema.parse(accepted)).toEqual(accepted)
  expect(auditFactSchema.safeParse({
    ...accepted,
    data: { ...accepted.data, name: 'Marko Vozač', phone: '+38591111', registrationPlate: 'ZG1001AA', guestName: 'Ana Anić', mustAccept: true },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...accepted,
    data: { ...accepted.data, vehicleId: 'c1c1c1c1-1111-4111-8111-111111111111' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...accepted,
    data: { ...accepted.data, fields: ['state', 'mustAccept'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...accepted,
    data: { ...accepted.data, fields: [] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...accepted, subjectUserId: memberId }).success).toBe(false)
})

it('records a Ride marked done by the Ride id, the Driver id, and the field name state', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const done = {
    action: 'ride.done' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      fields: ['state'] as const,
    },
  }
  expect(auditFactSchema.parse(done)).toEqual(done)
  expect(auditFactSchema.safeParse({
    ...done,
    data: { ...done.data, name: 'Marko Vozač', phone: '+38591111', guestName: 'Ana Anić' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...done,
    data: { ...done.data, fields: ['state', 'mustAccept'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...done, subjectUserId: memberId }).success).toBe(false)
})

it('records a No-show after the wait and an early office No-show as distinct actions, with no fee', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const afterWait = {
    action: 'ride.no_show' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      fields: ['state'] as const,
    },
  }
  const early = { ...afterWait, action: 'ride.no_show_early' as const }
  expect(auditFactSchema.parse(afterWait)).toEqual(afterWait)
  expect(auditFactSchema.parse(early)).toEqual(early)
  expect(auditFactSchema.safeParse({
    ...afterWait,
    data: { ...afterWait.data, fee: '10.00', charge: '10.00', guestName: 'Ana Anić' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...early,
    data: { ...early.data, price: '10.00' },
  }).success).toBe(false)
})

it('records a cancelled Ride by the Ride id, a Driver id or null, and the field name state', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const cancelled = {
    action: 'ride.cancelled' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      fields: ['state'] as const,
    },
  }
  expect(auditFactSchema.parse(cancelled)).toEqual(cancelled)
  const unassigned = {
    ...cancelled,
    data: { ...cancelled.data, driverId: null },
  }
  expect(auditFactSchema.parse(unassigned)).toEqual(unassigned)
  expect(auditFactSchema.safeParse({
    ...cancelled,
    data: { ...cancelled.data, name: 'Marko Vozač', phone: '+38591111', guestName: 'Ana Anić', mustAccept: true },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...cancelled,
    data: { ...cancelled.data, fields: ['state', 'mustAccept'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...cancelled, subjectUserId: memberId }).success).toBe(false)
})

it('records a landing time by the Ride id, a Driver id or null, and the field name landingAt', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const recorded = {
    action: 'ride.landing_recorded' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      fields: ['landingAt'] as const,
    },
  }
  expect(auditFactSchema.parse(recorded)).toEqual(recorded)
  const unassigned = {
    ...recorded,
    data: { ...recorded.data, driverId: null },
  }
  expect(auditFactSchema.parse(unassigned)).toEqual(unassigned)
  expect(auditFactSchema.safeParse({
    ...recorded,
    data: { ...recorded.data, landingAt: '2026-01-15T09:30:00.000Z', name: 'Marko Vozač', guestName: 'Ana Anić' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...recorded,
    data: { ...recorded.data, fields: ['landingAt', 'state'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...recorded, subjectUserId: memberId }).success).toBe(false)
})

it('records a decline by the Ride id, the Driver id, the Vehicle id, and the assignment field names', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const declined = {
    action: 'ride.declined' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      vehicleId,
      fields: ['state', 'driverId', 'vehicleId', 'mustAccept'] as const,
    },
  }
  expect(auditFactSchema.parse(declined)).toEqual(declined)
  expect(auditFactSchema.safeParse({
    ...declined,
    data: { ...declined.data, name: 'Marko Vozač', phone: '+38591111', guestName: 'Ana Anić' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...declined,
    data: { ...declined.data, fields: ['state'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...declined, subjectUserId: memberId }).success).toBe(false)
})

it('records an office acceptance by phone as the Ride id, the Driver id, and the field name state', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const accepted = {
    action: 'ride.accepted_by_phone' as const,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      fields: ['state'] as const,
    },
  }
  expect(auditFactSchema.parse(accepted)).toEqual(accepted)
  // An extra key is how a phone number would sit forever on an append-only row.
  expect(auditFactSchema.safeParse({
    ...accepted,
    data: { ...accepted.data, phone: '+38591111' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...accepted,
    data: { ...accepted.data, fields: ['state', 'mustAccept'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...accepted,
    data: { driverId, fields: ['state'] },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...accepted, subjectUserId: memberId }).success).toBe(false)
})

it('lists an acceptance with the Driver name and without a plate', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const listed = auditEntryListSchema.parse({
    entries: [{
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurredAt: '2026-10-03T18:42:00.000Z',
      actorUserId: adminId,
      actorName: 'Drago Driver',
      action: 'ride.accepted',
      subjectUserId: null,
      subjectName: null,
      driverName: 'Marko Vozač',
      vehiclePlate: null,
      data: {
        rideId,
        driverId,
        fields: ['state'],
      },
    }],
  })
  expect(listed.entries[0]).toMatchObject({ driverName: 'Marko Vozač' })
  expect(listed.entries[0]).not.toHaveProperty('vehiclePlate')
  expect(auditEntryListSchema.safeParse({
    entries: [{
      ...listed.entries[0],
      data: { ...listed.entries[0]!.data, registrationPlate: 'ZG1001AA' },
    }],
  }).success).toBe(false)
})

it('lists an office acceptance by phone with the actor name and without a plate', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const listed = auditEntryListSchema.parse({
    entries: [{
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurredAt: '2026-10-03T18:42:00.000Z',
      actorUserId: adminId,
      actorName: 'Dino Dispatcher',
      action: 'ride.accepted_by_phone',
      subjectUserId: null,
      subjectName: null,
      driverName: 'Marko Vozač',
      vehiclePlate: 'ZG8202AA',
      data: {
        rideId,
        driverId,
        fields: ['state'],
      },
    }, {
      id: '9e4b3f6d-5555-4555-8555-555555555555',
      occurredAt: '2026-10-03T18:41:00.000Z',
      actorUserId: memberId,
      actorName: null,
      action: 'ride.accepted_by_phone',
      subjectUserId: null,
      subjectName: null,
      data: {
        rideId,
        driverId,
        fields: ['state'],
      },
    }],
  })
  expect(listed.entries[0]).toMatchObject({ actorName: 'Dino Dispatcher' })
  expect(listed.entries[0]).not.toHaveProperty('vehiclePlate')
  expect(listed.entries[0]).not.toHaveProperty('driverName')
  expect(listed.entries[1]).toMatchObject({ actorName: null })
})

it('lists an assignment with the Driver name and Vehicle plate resolved at read time', () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const listed = auditEntryListSchema.parse({
    entries: [{
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurredAt: '2026-10-03T18:42:00.000Z',
      actorUserId: adminId,
      actorName: 'Ana Admin',
      action: 'ride.assigned',
      subjectUserId: null,
      subjectName: null,
      driverName: 'Ana Happy',
      vehiclePlate: 'DU100AA',
      data: {
        rideId,
        driverId,
        vehicleId,
        fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
      },
    }],
  })
  expect(listed.entries[0]).toMatchObject({ driverName: 'Ana Happy', vehiclePlate: 'DU100AA' })
  expect(auditEntryListSchema.safeParse({
    entries: [{
      ...listed.entries[0],
      data: { ...listed.entries[0]!.data, driverName: 'Ana Happy' },
    }],
  }).success).toBe(false)
})

it('records a roster day as ids and a calendar date, and refuses a plate, a name, or a phone', () => {
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
  const assigned = {
    action: 'roster.assigned' as const,
    subjectUserId: null,
    data: { rosterDate: '2026-10-05', driverId, vehicleId },
  }
  expect(auditFactSchema.parse(assigned)).toEqual(assigned)
  expect(auditFactSchema.safeParse({
    ...assigned,
    data: { ...assigned.data, registrationPlate: 'DU123AB' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...assigned,
    data: { ...assigned.data, name: 'Ana', phone: '+38591111' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({
    ...assigned,
    data: { ...assigned.data, rosterDate: '2026-02-31' },
  }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...assigned, subjectUserId: memberId }).success).toBe(false)

  const changed = {
    action: 'roster.changed' as const,
    subjectUserId: null,
    data: { rosterDate: '2026-10-05', driverId, fromVehicleId: vehicleId, toVehicleId: otherVehicleId },
  }
  expect(auditFactSchema.parse(changed)).toEqual(changed)
  expect(auditFactSchema.safeParse({
    ...changed,
    data: { ...changed.data, registrationPlate: 'DU123AB' },
  }).success).toBe(false)

  const cleared = {
    action: 'roster.cleared' as const,
    subjectUserId: null,
    data: { rosterDate: '2026-10-05', driverId, vehicleId },
  }
  expect(auditFactSchema.parse(cleared)).toEqual(cleared)
  expect(auditFactSchema.safeParse({
    ...cleared,
    data: { driverId, vehicleId },
  }).success).toBe(false)
})

it('records a platform rename, deactivation, or reactivation with an empty object and no person', () => {
  for (const action of ['tenant.renamed', 'tenant.suspended', 'tenant.reactivated'] as const) {
    const entry = { action, subjectUserId: null, data: {} }
    expect(auditFactSchema.parse(entry)).toEqual(entry)
    expect(auditFactSchema.safeParse({ ...entry, subjectUserId: adminId }).success).toBe(false)
    expect(auditFactSchema.safeParse({ ...entry, data: { name: 'Mora' } }).success).toBe(false)
    expect(auditFactSchema.safeParse({ ...entry, data: { email: 'ana@example.test' } }).success).toBe(false)
  }
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

it('records an unavailability window by ids and field names only, never the instants', () => {
  const windowId = 'a1a1a1a1-1111-4111-8111-111111111111'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const partnerId = 'a1a1a1a1-1111-4111-8111-111111111111'
  const added = { action: 'unavailability.added' as const, subjectUserId: null, data: { windowId, driverId, vehicleId: null, partnerId: null, fields: ['startsAt', 'endsAt'] } }
  expect(auditFactSchema.parse(added)).toEqual(added)
  const changed = { action: 'unavailability.changed' as const, subjectUserId: null, data: { windowId, driverId: null, vehicleId, partnerId: null, fields: ['endsAt'] } }
  expect(auditFactSchema.parse(changed)).toEqual(changed)
  const removed = { action: 'unavailability.removed' as const, subjectUserId: null, data: { windowId, driverId: null, vehicleId: null, partnerId, fields: ['removed'] } }
  expect(auditFactSchema.parse(removed)).toEqual(removed)

  // An instant is how a Driver's absence would stay forever on a row that is never deleted.
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, startsAt: '2026-10-20T08:00:00.000Z' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, fields: ['2026-10-20T08:00:00.000Z'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, fields: [] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, fields: ['endsAt', 'endsAt'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, fields: ['startsAt'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...removed, data: { ...removed.data, fields: ['startsAt'] } }).success).toBe(false)
  // Exactly one of the Driver, the Vehicle, and the Partner.
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, vehicleId } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, partnerId } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, driverId: null } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, reason: 'sick' } }).success).toBe(false)
})

it('records a contact person by the Client id, the contact person id, and the field names', () => {
  const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
  const contactPersonId = '1d2c3b4a-6666-4666-8666-666666666666'
  const added = {
    action: 'contact_person.added' as const,
    subjectUserId: null,
    data: { clientId, contactPersonId, fields: ['name', 'role', 'phone'] as const },
  }
  expect(auditFactSchema.parse(added)).toEqual(added)
  const changed = {
    action: 'contact_person.changed' as const,
    subjectUserId: null,
    data: { clientId, contactPersonId, fields: ['email'] as const },
  }
  expect(auditFactSchema.parse(changed)).toEqual(changed)
  const removed = {
    action: 'contact_person.removed' as const,
    subjectUserId: null,
    data: { clientId, contactPersonId, fields: ['removed'] as const },
  }
  expect(auditFactSchema.parse(removed)).toEqual(removed)

  // A name, a role, a phone, or an email would stay forever on a row that is never deleted.
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, name: 'Ana Booking' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, role: 'accounting' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, phone: '+385911110364' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, email: 'booking@example.test' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...added, data: { ...added.data, fields: ['phone'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, fields: ['email', 'name'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...removed, data: { ...removed.data, fields: ['name'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...added, subjectUserId: memberId }).success).toBe(false)
})

it('records a Client note by the Client id and the field name, never the text', () => {
  const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
  const saved = {
    action: 'client_note.saved' as const,
    subjectUserId: null,
    data: { clientId, fields: ['note'] as const },
  }
  expect(auditFactSchema.parse(saved)).toEqual(saved)
  // The text would stay forever on a row that is never deleted.
  expect(auditFactSchema.safeParse({ ...saved, data: { ...saved.data, note: 'Gosti se čekaju na izlazu.' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...saved, data: { ...saved.data, text: 'Gosti se čekaju na izlazu.' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...saved, data: { ...saved.data, fields: ['text'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...saved, data: { ...saved.data, fields: [] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...saved, data: { clientId } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...saved, subjectUserId: memberId }).success).toBe(false)
})

it('records a Partner by id and field names, and refuses the name, the phone, the email, and the note', () => {
  const partnerId = '2e3d4c5b-7777-4777-8777-777777777777'
  const created = {
    action: 'partner.created' as const,
    subjectUserId: null,
    data: { partnerId, fields: ['name', 'phone', 'email', 'note'] as const },
  }
  expect(auditFactSchema.parse(created)).toEqual(created)
  const changed = {
    action: 'partner.changed' as const,
    subjectUserId: null,
    data: { partnerId, fields: ['note'] as const },
  }
  expect(auditFactSchema.parse(changed)).toEqual(changed)
  const archived = {
    action: 'partner.archived' as const,
    subjectUserId: null,
    data: { partnerId },
  }
  expect(auditFactSchema.parse(archived)).toEqual(archived)
  const restored = {
    action: 'partner.restored' as const,
    subjectUserId: null,
    data: { partnerId },
  }
  expect(auditFactSchema.parse(restored)).toEqual(restored)

  // A name, a phone, an email, or a note would stay forever on a row that is never deleted.
  expect(auditFactSchema.safeParse({ ...created, data: { ...created.data, name: 'Mora Transfer' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, data: { ...created.data, phone: '+385911110000' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, email: 'office@mora.example' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, note: 'Call the desk.' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, data: { ...created.data, fields: ['phone'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...changed, data: { ...changed.data, fields: ['email', 'name'] } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...archived, data: { partnerId, name: 'Mora Transfer' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...created, subjectUserId: memberId }).success).toBe(false)
})
