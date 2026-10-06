import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { assignUnassignedRide, RideNotFoundError, RideNotUnassignedError, RideVehicleArchivedError, suggestRosterVehicle } from './assign'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const transferId = 'd1d1d1d1-1111-4111-8111-111111111111'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const dialect = new PgDialect()

interface Script {
  rideState?: 'unassigned' | 'assigned' | 'missing'
  driverMustAccept?: boolean | 'missing'
  vehicle?: 'active' | 'archived' | 'missing'
  updateWins?: boolean
  pickupAt?: Date
  rosterVehicleId?: string | null
  rosterVehicle?: 'active' | 'archived' | 'missing'
}

function fakeTransaction(script: Script) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (text.includes('for update') && text.includes('from app.rides')) {
        if (script.rideState === 'missing')
          return { rows: [] }
        return { rows: [{ id: rideId, state: script.rideState ?? 'unassigned' }] }
      }
      if (text.includes('from app.drivers')) {
        if (script.driverMustAccept === 'missing')
          return { rows: [] }
        return {
          rows: [{
            id: driverId,
            name: 'Marko Vozač',
            kind: 'own',
            phone: '+385911110001',
            drivingLicenceExpiresOn: '2030-01-01',
            transportLicenceExpiresOn: '2030-06-01',
            memberUserId: null,
            mustAccept: script.driverMustAccept ?? false,
          }],
        }
      }
      if (text.includes('from app.vehicles')) {
        // Prefill asks after the roster read. Assign asks before any roster read.
        const afterRoster = queries.slice(0, -1).some(query => query.sql.includes('from app.roster'))
        const presence = (afterRoster ? script.rosterVehicle : script.vehicle) ?? 'active'
        if (presence === 'missing')
          return { rows: [] }
        return {
          rows: [{
            id: compiled.params[0],
            archivedAt: presence === 'archived' ? new Date('2026-10-01T00:00:00.000Z') : null,
          }],
        }
      }
      if (text.includes('update app.rides')) {
        if (script.updateWins === false)
          return { rows: [] }
        return {
          rows: [{
            id: rideId,
            transferId,
            state: 'assigned',
            driverId: compiled.params[0],
            vehicleId: compiled.params[1],
            mustAccept: compiled.params[2],
          }],
        }
      }
      if (text.includes('from app.rides')) {
        if (script.pickupAt === undefined)
          return { rows: [] }
        return { rows: [{ id: rideId, pickupAt: script.pickupAt }] }
      }
      if (text.includes('from app.tenant_settings')) {
        return { rows: [{ airport_wait_minutes: 90, elsewhere_wait_minutes: 25, time_zone: 'Europe/Zagreb' }] }
      }
      if (text.includes('from app.roster')) {
        if (script.rosterVehicleId == null)
          return { rows: [] }
        return { rows: [{ vehicleId: script.rosterVehicleId }] }
      }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function wroteAssignment(queries: Array<{ sql: string }>): boolean {
  return queries.some(query => query.sql.includes('update app.rides') || query.sql.includes('audit.append_entry'))
}

it('assigns only from unassigned, copies must-accept, and names fields not a plate or a phone', async () => {
  const { transaction, queries } = fakeTransaction({ driverMustAccept: true })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).resolves.toEqual({
    id: rideId,
    transferId,
    state: 'assigned',
    driverId,
    vehicleId,
    mustAccept: true,
  })
  const driverQuery = queries.find(query => query.sql.includes('from app.drivers'))
  expect(driverQuery?.sql).toContain('must_accept')
  expect(driverQuery?.sql).not.toContain('phone')
  const update = queries.find(query => query.sql.includes('update app.rides'))
  expect(update?.sql).toContain('state = \'unassigned\'')
  expect(update?.params).toEqual([driverId, vehicleId, true, rideId])
  const audit = queries.find(query => query.params[0] === 'ride.assigned')
  expect(audit?.params[1]).toBe(actorUserId)
  expect(audit?.params[2]).toBeNull()
  expect(audit?.params[3]).toBe(JSON.stringify({
    rideId,
    driverId,
    vehicleId,
    fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
  }))
  const auditText = String(audit?.params[3])
  expect(auditText).not.toContain('+385911110001')
  expect(auditText).not.toContain('ZG')
  expect(queries.filter(query => query.sql.includes('for update'))).toHaveLength(1)
})

it('copies false when that is the Driver setting at the call', async () => {
  const { transaction, queries } = fakeTransaction({ driverMustAccept: false })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).resolves.toMatchObject({
    mustAccept: false,
  })
  expect(queries.find(query => query.sql.includes('update app.rides'))?.params[2]).toBe(false)
})

it('refuses a Ride that is not unassigned, and writes no transition and no audit entry', async () => {
  const { transaction, queries } = fakeTransaction({ rideState: 'assigned' })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).rejects.toBeInstanceOf(RideNotUnassignedError)
  expect(wroteAssignment(queries)).toBe(false)
})

it('refuses a missing Ride before it loads a Driver', async () => {
  const { transaction, queries } = fakeTransaction({ rideState: 'missing' })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).rejects.toBeInstanceOf(RideNotFoundError)
  expect(queries.some(query => query.sql.includes('from app.drivers'))).toBe(false)
  expect(wroteAssignment(queries)).toBe(false)
})

it('refuses a Driver that is not in this Tenant, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({ driverMustAccept: 'missing' })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).rejects.toBeInstanceOf(RideNotFoundError)
  expect(wroteAssignment(queries)).toBe(false)
})

it('refuses an archived Vehicle, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({ vehicle: 'archived' })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).rejects.toBeInstanceOf(RideVehicleArchivedError)
  expect(wroteAssignment(queries)).toBe(false)
})

it('refuses a Vehicle that is not in this Tenant, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({ vehicle: 'missing' })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).rejects.toBeInstanceOf(RideNotFoundError)
  expect(wroteAssignment(queries)).toBe(false)
})

it('treats a lost update as a conflict and appends nothing', async () => {
  const { transaction, queries } = fakeTransaction({ updateWins: false })
  await expect(assignUnassignedRide(transaction, actorUserId, { rideId, driverId, vehicleId })).rejects.toBeInstanceOf(RideNotUnassignedError)
  expect(queries.some(query => query.sql.includes('audit.append_entry'))).toBe(false)
})

it('suggests the roster Vehicle for the pickup local day, and skips an archived one', async () => {
  const beforeMidnight = fakeTransaction({
    pickupAt: new Date('2026-10-05T21:59:00.000Z'),
    rosterVehicleId: vehicleId,
    rosterVehicle: 'active',
  })
  await expect(suggestRosterVehicle(beforeMidnight.transaction, rideId, driverId)).resolves.toEqual({ vehicleId })
  expect(beforeMidnight.queries.find(query => query.sql.includes('from app.roster'))?.params).toEqual([driverId, '2026-10-05'])

  const afterMidnight = fakeTransaction({
    pickupAt: new Date('2026-10-05T22:00:00.000Z'),
    rosterVehicleId: otherVehicleId,
    rosterVehicle: 'active',
  })
  await expect(suggestRosterVehicle(afterMidnight.transaction, rideId, driverId)).resolves.toEqual({ vehicleId: otherVehicleId })
  expect(afterMidnight.queries.find(query => query.sql.includes('from app.roster'))?.params).toEqual([driverId, '2026-10-06'])

  const archived = fakeTransaction({
    pickupAt: new Date('2026-10-05T21:59:00.000Z'),
    rosterVehicleId: vehicleId,
    rosterVehicle: 'archived',
  })
  await expect(suggestRosterVehicle(archived.transaction, rideId, driverId)).resolves.toEqual({ vehicleId: null })
  expect(archived.queries.some(query => query.sql.includes('update app.rides'))).toBe(false)

  const empty = fakeTransaction({
    pickupAt: new Date('2026-10-05T21:59:00.000Z'),
    rosterVehicleId: null,
  })
  await expect(suggestRosterVehicle(empty.transaction, rideId, driverId)).resolves.toEqual({ vehicleId: null })
  expect(empty.queries.some(query => query.sql.includes('from app.vehicles'))).toBe(false)
})

it('refuses a pre-fill when the Ride or the Driver is not in this Tenant', async () => {
  const missingRide = fakeTransaction({})
  await expect(suggestRosterVehicle(missingRide.transaction, rideId, driverId)).rejects.toBeInstanceOf(RideNotFoundError)
  expect(missingRide.queries.some(query => query.sql.includes('from app.roster'))).toBe(false)

  const missingDriver = fakeTransaction({ pickupAt: new Date('2026-10-05T21:59:00.000Z'), driverMustAccept: 'missing' })
  await expect(suggestRosterVehicle(missingDriver.transaction, rideId, driverId)).rejects.toBeInstanceOf(RideNotFoundError)
  expect(missingDriver.queries.some(query => query.sql.includes('from app.roster'))).toBe(false)
})
