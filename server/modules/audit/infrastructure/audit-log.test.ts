import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { appendAuditEntry, listAuditEntries } from './audit-log'

const adminId = '7c2f1d4b-3333-4333-8333-333333333333'
const memberId = '6b1e0c3a-2222-4222-8222-222222222222'
const dialect = new PgDialect()

function fakeTransaction(rows: unknown[] = []) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query))
      return { rows }
    }),
  }
  return { transaction, queries }
}

it('appends one entry with the action, the actor, the member, and the data, and no tenant id', async () => {
  const { transaction, queries } = fakeTransaction()
  await appendAuditEntry(transaction, {
    action: 'member.role_changed',
    actorUserId: adminId,
    subjectUserId: memberId,
    data: { from: 'driver', to: 'dispatcher' },
  })
  expect(queries).toHaveLength(1)
  // The Tenant is whatever the open session set; the caller cannot pass one.
  expect(queries[0]?.params).toEqual([
    'member.role_changed',
    adminId,
    memberId,
    JSON.stringify({ from: 'driver', to: 'dispatcher' }),
  ])
})

it('refuses an entry with an extra data key, no actor, or a missing member before the database sees it', async () => {
  const { transaction } = fakeTransaction()
  await expect(appendAuditEntry(transaction, {
    action: 'member.removed',
    actorUserId: adminId,
    subjectUserId: memberId,
    // @ts-expect-error the data object is strict
    data: { role: 'driver', email: 'ana@example.com' },
  })).rejects.toThrow()
  await expect(appendAuditEntry(transaction, {
    action: 'member.removed',
    actorUserId: '',
    subjectUserId: memberId,
    data: { role: 'driver' },
  })).rejects.toThrow()
  // @ts-expect-error a removal names the member
  await expect(appendAuditEntry(transaction, {
    action: 'member.removed',
    actorUserId: adminId,
    subjectUserId: null,
    data: { role: 'driver' },
  })).rejects.toThrow()
  expect(transaction.execute).not.toHaveBeenCalled()
})

it('lists rows newest first as the API shape, keeping a former member\'s name null', async () => {
  const entries = [
    {
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurredAt: '2026-10-03T18:43:00.000Z',
      action: 'member.removed',
      actorUserId: adminId,
      actorName: 'Ana Admin',
      subjectUserId: memberId,
      subjectName: null,
      data: { role: 'driver' },
    },
    {
      id: '9e4b3f6d-5555-4555-8555-555555555555',
      occurredAt: '2026-10-03T18:42:00.000Z',
      action: 'member.invited',
      actorUserId: adminId,
      actorName: 'Ana Admin',
      subjectUserId: null,
      subjectName: null,
      data: { role: 'dispatcher' },
    },
  ]
  const { transaction, queries } = fakeTransaction(entries)
  expect(await listAuditEntries(transaction)).toEqual({ entries })
  // The columns are aliased to the API's field names, so the rows parse as they come.
  expect(queries[0]?.sql).toContain('as "occurredAt"')
  expect(queries[0]?.sql).toContain('order by e.occurred_at desc, e.id desc')
})

it('lists a ride.assigned entry with the Driver name and Vehicle plate from the catalog join', async () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const entries = [{
    id: '8d3a2e5c-4444-4444-8444-444444444444',
    occurredAt: '2026-10-03T18:43:00.000Z',
    action: 'ride.assigned' as const,
    actorUserId: adminId,
    actorName: 'Ana Admin',
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
  }]
  const { transaction, queries } = fakeTransaction(entries)
  expect(await listAuditEntries(transaction)).toEqual({ entries })
  expect(queries[0]?.sql).toContain('join app.drivers')
  expect(queries[0]?.sql).toContain('join app.vehicles')
  expect(queries[0]?.sql).toContain('as "driverName"')
  expect(queries[0]?.sql).toContain('as "vehiclePlate"')
  expect(queries[0]?.sql).not.toContain('phone')
})

it('lists a ride.accepted entry with the Driver name and does not join the plate', async () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const stored = {
    id: '8d3a2e5c-4444-4444-8444-444444444444',
    occurredAt: '2026-10-03T18:43:00.000Z',
    action: 'ride.accepted' as const,
    actorUserId: adminId,
    actorName: 'Drago Driver',
    subjectUserId: null,
    subjectName: null,
    driverName: 'Marko Vozač',
    data: {
      rideId,
      driverId,
      fields: ['state'],
    },
  }
  // The select still returns the plate column. Acceptance does not use it.
  const { transaction, queries } = fakeTransaction([{ ...stored, vehiclePlate: null }])
  expect(await listAuditEntries(transaction)).toEqual({ entries: [stored] })
  const text = queries[0]?.sql ?? ''
  const vehicleJoin = text.slice(text.indexOf('left join app.vehicles'))
  expect(text).toContain('ride.accepted')
  expect(text).toContain('as "driverName"')
  expect(vehicleJoin).not.toContain('ride.accepted')
  expect(text).not.toContain('phone')
})

it('lists a ride.accepted_by_phone entry with the actor name, and does not join the plate', async () => {
  const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const named = {
    id: '8d3a2e5c-4444-4444-8444-444444444444',
    occurredAt: '2026-10-03T18:43:00.000Z',
    action: 'ride.accepted_by_phone' as const,
    actorUserId: adminId,
    actorName: 'Dino Dispatcher',
    subjectUserId: null,
    subjectName: null,
    data: {
      rideId,
      driverId,
      fields: ['state'],
    },
  }
  // A member who has left the Tenant has no row in tenant_member, so the name stays null.
  const departed = {
    ...named,
    id: '9e4b3f6d-5555-4555-8555-555555555555',
    actorUserId: memberId,
    actorName: null,
  }
  const { transaction, queries } = fakeTransaction([
    { ...named, driverName: 'Marko Vozač', vehiclePlate: 'ZG8202AA' },
    { ...departed, driverName: null, vehiclePlate: null },
  ])
  expect(await listAuditEntries(transaction)).toEqual({ entries: [named, departed] })
  const text = queries[0]?.sql ?? ''
  const vehicleJoin = text.slice(text.indexOf('left join app.vehicles'))
  expect(text).toContain('left join app.tenant_member as actor')
  expect(vehicleJoin).not.toContain('accepted_by_phone')
  expect(text).not.toContain('phone')
})

it('fails the read on a row whose data does not match its action', async () => {
  const { transaction } = fakeTransaction([{
    id: '8d3a2e5c-4444-4444-8444-444444444444',
    occurredAt: '2026-10-03T18:43:00.000Z',
    action: 'member.role_changed',
    actorUserId: adminId,
    actorName: 'Ana Admin',
    subjectUserId: memberId,
    subjectName: 'Dora Driver',
    data: { role: 'driver' },
  }])
  await expect(listAuditEntries(transaction)).rejects.toThrow()
})
