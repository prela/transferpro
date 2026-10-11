import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { RideNotFoundError, RideVehicleArchivedError } from './assign'
import { changeRideVehicle, clearAssignedRide, reassignAssignedRide, RideNotOpenError, RideSameDriverError, RideVehicleUnchangedError } from './ride-change'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const transferId = 'd1d1d1d1-1111-4111-8111-111111111111'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const dialect = new PgDialect()

interface Script {
  state?: 'assigned' | 'accepted' | 'unassigned' | 'done' | 'no-show' | 'cancelled' | 'missing'
  driverId?: string | null
  vehicleId?: string | null
  mustAccept?: boolean | null
  /** The Driver named on a reassignment. Missing means that Driver is not in this Tenant. */
  nextMustAccept?: boolean | 'missing'
  vehicle?: 'active' | 'archived' | 'missing'
  updateWins?: boolean
}

function fakeTransaction(script: Script) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (text.includes('for update') && text.includes('from app.rides')) {
        if (script.state === 'missing')
          return { rows: [] }
        return {
          rows: [{
            id: rideId,
            state: script.state ?? 'assigned',
            driverId: script.driverId === undefined ? driverId : script.driverId,
            vehicleId: script.vehicleId === undefined ? vehicleId : script.vehicleId,
            mustAccept: script.mustAccept === undefined ? true : script.mustAccept,
          }],
        }
      }
      if (text.includes('from app.drivers')) {
        if (script.nextMustAccept === 'missing')
          return { rows: [] }
        return { rows: [{ mustAccept: script.nextMustAccept ?? false }] }
      }
      if (text.includes('from app.vehicles')) {
        const presence = script.vehicle ?? 'active'
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
        // The WHERE clause may name `assigned` as a guard. The SET clause says which command this is.
        const setClause = text.slice(0, text.indexOf('where'))
        if (setClause.includes('\'unassigned\'')) {
          return {
            rows: [{
              id: rideId,
              transferId,
              state: 'unassigned',
              driverId: null,
              vehicleId: null,
              mustAccept: null,
            }],
          }
        }
        if (setClause.includes('\'assigned\'')) {
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
        return {
          rows: [{
            id: rideId,
            transferId,
            state: script.state === 'accepted' ? 'accepted' : 'assigned',
            driverId,
            vehicleId: compiled.params[0],
            mustAccept: script.mustAccept === undefined ? true : script.mustAccept,
          }],
        }
      }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function wrote(queries: Array<{ sql: string }>): boolean {
  return queries.some(query => query.sql.includes('update app.rides') || query.sql.includes('audit.append_entry'))
}

it('changes only the Vehicle on an assigned Ride and keeps the state and the copied flag', async () => {
  const { transaction, queries } = fakeTransaction({ state: 'assigned', mustAccept: true })
  await expect(changeRideVehicle(transaction, actorUserId, { rideId, vehicleId: otherVehicleId })).resolves.toEqual({
    id: rideId,
    transferId,
    state: 'assigned',
    driverId,
    vehicleId: otherVehicleId,
    mustAccept: true,
  })
  const update = queries.find(query => query.sql.includes('update app.rides'))
  const setClause = update?.sql.slice(0, update.sql.indexOf('where')) ?? ''
  expect(setClause).toContain('vehicle_id')
  expect(setClause).not.toContain('must_accept')
  expect(setClause).not.toContain('state')
  const audit = queries.find(query => query.params[0] === 'ride.vehicle_changed')
  expect(audit?.params[1]).toBe(actorUserId)
  expect(audit?.params[2]).toBeNull()
  expect(audit?.params[3]).toBe(JSON.stringify({
    rideId,
    driverId,
    vehicleId: otherVehicleId,
    fields: ['vehicleId'],
  }))
  expect(String(audit?.params[3])).not.toContain('ZG')
  expect(String(audit?.params[3])).not.toContain('true')
  expect(queries.some(query => query.sql.includes('from app.drivers'))).toBe(false)
})

it('changes only the Vehicle on an accepted Ride and leaves it accepted', async () => {
  const { transaction, queries } = fakeTransaction({ state: 'accepted', mustAccept: true })
  await expect(changeRideVehicle(transaction, actorUserId, { rideId, vehicleId: otherVehicleId })).resolves.toMatchObject({
    state: 'accepted',
    driverId,
    vehicleId: otherVehicleId,
    mustAccept: true,
  })
  expect(queries.find(query => query.params[0] === 'ride.vehicle_changed')?.params[1]).toBe(actorUserId)
})

it('refuses the same Vehicle, and writes no transition', async () => {
  const { transaction, queries } = fakeTransaction({})
  await expect(changeRideVehicle(transaction, actorUserId, { rideId, vehicleId })).rejects.toBeInstanceOf(RideVehicleUnchangedError)
  expect(wrote(queries)).toBe(false)
})

it('refuses a vehicle change when the Ride is not assigned or accepted, and writes nothing', async () => {
  for (const state of ['unassigned', 'done', 'no-show', 'cancelled'] as const) {
    const { transaction, queries } = fakeTransaction({ state, driverId: null, vehicleId: null, mustAccept: null })
    await expect(changeRideVehicle(transaction, actorUserId, { rideId, vehicleId: otherVehicleId })).rejects.toBeInstanceOf(RideNotOpenError)
    expect(wrote(queries)).toBe(false)
  }
})

it('refuses a missing Ride before it loads a Vehicle', async () => {
  const { transaction, queries } = fakeTransaction({ state: 'missing' })
  await expect(changeRideVehicle(transaction, actorUserId, { rideId, vehicleId: otherVehicleId })).rejects.toBeInstanceOf(RideNotFoundError)
  expect(queries.some(query => query.sql.includes('from app.vehicles'))).toBe(false)
  expect(wrote(queries)).toBe(false)
})

it('refuses an archived Vehicle on a vehicle change, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({ vehicle: 'archived' })
  await expect(changeRideVehicle(transaction, actorUserId, { rideId, vehicleId: otherVehicleId })).rejects.toBeInstanceOf(RideVehicleArchivedError)
  expect(wrote(queries)).toBe(false)
})

it('clears an assigned or accepted Ride and names the actor and the ids that were cleared', async () => {
  for (const state of ['assigned', 'accepted'] as const) {
    const { transaction, queries } = fakeTransaction({ state, mustAccept: true })
    await expect(clearAssignedRide(transaction, actorUserId, rideId)).resolves.toEqual({
      id: rideId,
      transferId,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
    })
    const update = queries.find(query => query.sql.includes('update app.rides'))
    expect(update?.sql).toContain('\'unassigned\'')
    expect(update?.sql).toContain('driver_id = null')
    expect(update?.sql).toContain('vehicle_id = null')
    expect(update?.sql).toContain('must_accept = null')
    const audit = queries.find(query => query.params[0] === 'ride.cleared')
    expect(audit?.params[1]).toBe(actorUserId)
    expect(audit?.params[3]).toBe(JSON.stringify({
      rideId,
      driverId,
      vehicleId,
      fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
    }))
    expect(String(audit?.params[3])).not.toContain('+385')
    expect(String(audit?.params[3])).not.toContain('true')
  }
})

it('refuses a clear when the Ride is not assigned or accepted, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({ state: 'done', mustAccept: true })
  await expect(clearAssignedRide(transaction, actorUserId, rideId)).rejects.toBeInstanceOf(RideNotOpenError)
  expect(wrote(queries)).toBe(false)
})

it('reassigns an accepted Ride to another Driver, copies that Driver\'s flag, and moves it to assigned', async () => {
  const { transaction, queries } = fakeTransaction({ state: 'accepted', mustAccept: true, nextMustAccept: false })
  await expect(reassignAssignedRide(transaction, actorUserId, {
    rideId,
    driverId: otherDriverId,
    vehicleId: otherVehicleId,
  })).resolves.toEqual({
    id: rideId,
    transferId,
    state: 'assigned',
    driverId: otherDriverId,
    vehicleId: otherVehicleId,
    mustAccept: false,
  })
  const driverQuery = queries.find(query => query.sql.includes('from app.drivers'))
  expect(driverQuery?.sql).toContain('for share')
  expect(driverQuery?.params).toEqual([otherDriverId])
  const update = queries.find(query => query.sql.includes('update app.rides'))
  expect(update?.sql).toContain('\'assigned\'')
  expect(update?.params.slice(0, 3)).toEqual([otherDriverId, otherVehicleId, false])
  const audit = queries.find(query => query.params[0] === 'ride.reassigned')
  expect(audit?.params[1]).toBe(actorUserId)
  expect(audit?.params[3]).toBe(JSON.stringify({
    rideId,
    driverId: otherDriverId,
    vehicleId: otherVehicleId,
    fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
  }))
  expect(String(audit?.params[3])).not.toContain(driverId)
  expect(String(audit?.params[3])).not.toContain('false')
})

it('copies true when that is the new Driver\'s setting, including from assigned', async () => {
  const { transaction } = fakeTransaction({ state: 'assigned', mustAccept: false, nextMustAccept: true })
  await expect(reassignAssignedRide(transaction, actorUserId, {
    rideId,
    driverId: otherDriverId,
    vehicleId: otherVehicleId,
  })).resolves.toMatchObject({ state: 'assigned', mustAccept: true, driverId: otherDriverId })
})

it('refuses a reassignment to the same Driver, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({})
  await expect(reassignAssignedRide(transaction, actorUserId, {
    rideId,
    driverId,
    vehicleId: otherVehicleId,
  })).rejects.toBeInstanceOf(RideSameDriverError)
  expect(queries.some(query => query.sql.includes('from app.drivers'))).toBe(false)
  expect(wrote(queries)).toBe(false)
})

it('refuses a reassignment when the new Driver is not in this Tenant, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({ nextMustAccept: 'missing' })
  await expect(reassignAssignedRide(transaction, actorUserId, {
    rideId,
    driverId: otherDriverId,
    vehicleId: otherVehicleId,
  })).rejects.toBeInstanceOf(RideNotFoundError)
  expect(wrote(queries)).toBe(false)
})

it('refuses a reassignment when the Ride is not open, and writes nothing', async () => {
  const { transaction, queries } = fakeTransaction({ state: 'unassigned', driverId: null, vehicleId: null, mustAccept: null })
  await expect(reassignAssignedRide(transaction, actorUserId, {
    rideId,
    driverId: otherDriverId,
    vehicleId: otherVehicleId,
  })).rejects.toBeInstanceOf(RideNotOpenError)
  expect(wrote(queries)).toBe(false)
})
