import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { RosterInputError } from '../../../../shared'
import { createLogger, handleLoggedError } from '../../../core/index'
import { TenantSettingsMissingError } from '../../tenancy'
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
  /** Throw this message when the statement text includes `failSql`. The bound ids stay in that message. */
  fail?: { sql: string, message: string, code?: string }
  missingSettings?: boolean
}

function fakeTransaction(script: Script) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (script.fail && text.includes(script.fail.sql)) {
        if (script.fail.code) {
          const cause = Object.assign(new Error('pg'), { code: script.fail.code, detail: script.fail.message })
          throw Object.assign(new Error(script.fail.message), { cause })
        }
        throw new Error(script.fail.message)
      }
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
        if (script.missingSettings)
          return { rows: [] }
        return { rows: [{ airport_wait_minutes: 90, elsewhere_wait_minutes: 25, time_zone: 'Europe/Zagreb', operational_day_start_hour: 5 }] }
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

function logLine(error: unknown): string {
  let line = ''
  const destination: Writable = new Writable({
    write(chunk, _encoding, callback) {
      line += String(chunk)
      callback()
    },
  })
  handleLoggedError(createLogger({ level: 'debug', destination }), error, 'req-assign')
  return line
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
  expect(driverQuery?.sql).toContain('for share')
  expect(driverQuery?.sql).not.toContain('phone')
  const vehicleQuery = queries.find(query => query.sql.includes('from app.vehicles'))
  expect(vehicleQuery?.sql).toContain('for share')
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

it('replaces a database failure so the log line does not keep the bound ids', async () => {
  const leaked = `duplicate ${driverId} ${vehicleId} ${rideId}`
  const update = fakeTransaction({ fail: { sql: 'update app.rides', message: leaked } })
  const updateError = await assignUnassignedRide(update.transaction, actorUserId, { rideId, driverId, vehicleId }).catch(caught => caught)
  expect(updateError).toMatchObject({ message: 'Ride assignment failed' })
  expect(String(updateError)).not.toContain(driverId)
  expect(logLine(updateError)).not.toContain(vehicleId)
  expect(update.queries.some(query => query.sql.includes('audit.append_entry'))).toBe(false)

  const driver = fakeTransaction({ fail: { sql: 'from app.drivers', message: leaked } })
  const driverError = await assignUnassignedRide(driver.transaction, actorUserId, { rideId, driverId, vehicleId }).catch(caught => caught)
  expect(driverError).toMatchObject({ message: 'Driver read failed' })
  expect(String(driverError)).not.toContain(driverId)
  expect(logLine(driverError)).not.toContain(rideId)
  expect(wroteAssignment(driver.queries)).toBe(false)

  const vehicle = fakeTransaction({ fail: { sql: 'from app.vehicles', message: leaked } })
  const vehicleError = await assignUnassignedRide(vehicle.transaction, actorUserId, { rideId, driverId, vehicleId }).catch(caught => caught)
  expect(vehicleError).toMatchObject({ message: 'Vehicle read failed' })
  expect(String(vehicleError)).not.toContain(vehicleId)
  expect(logLine(vehicleError)).not.toContain(driverId)
  expect(wroteAssignment(vehicle.queries)).toBe(false)
})

it('replaces a pre-fill read failure so the log line does not keep the ride id', async () => {
  const leaked = `pickup ${rideId}`
  const { transaction } = fakeTransaction({
    pickupAt: new Date('2026-10-05T21:59:00.000Z'),
    fail: { sql: 'pickup_at', message: leaked },
  })
  const error = await suggestRosterVehicle(transaction, rideId, driverId).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Ride read failed' })
  expect(String(error)).not.toContain(rideId)
  expect(logLine(error)).not.toContain(rideId)
})

it('replaces a pre-fill catalog failure so the log line does not keep the bound ids', async () => {
  const leaked = `bound ${driverId} ${vehicleId} ${rideId}`
  const pickupAt = new Date('2026-10-05T21:59:00.000Z')

  const driver = fakeTransaction({ pickupAt, fail: { sql: 'from app.drivers', message: leaked } })
  const driverError = await suggestRosterVehicle(driver.transaction, rideId, driverId).catch(caught => caught)
  expect(driverError).toMatchObject({ message: 'Ride read failed' })
  expect(String(driverError)).not.toContain(driverId)
  expect(logLine(driverError)).not.toContain(driverId)

  const roster = fakeTransaction({ pickupAt, fail: { sql: 'from app.roster', message: leaked } })
  const rosterError = await suggestRosterVehicle(roster.transaction, rideId, driverId).catch(caught => caught)
  expect(rosterError).toMatchObject({ message: 'Ride read failed' })
  expect(String(rosterError)).not.toContain(driverId)
  expect(logLine(rosterError)).not.toContain(rideId)

  const vehicle = fakeTransaction({
    pickupAt,
    rosterVehicleId: vehicleId,
    rosterVehicle: 'active',
    fail: { sql: 'from app.vehicles', message: leaked },
  })
  const vehicleError = await suggestRosterVehicle(vehicle.transaction, rideId, driverId).catch(caught => caught)
  expect(vehicleError).toMatchObject({ message: 'Ride read failed' })
  expect(String(vehicleError)).not.toContain(vehicleId)
  expect(logLine(vehicleError)).not.toContain(vehicleId)
})

it('keeps a missing-settings error by type, and wraps a generic error with the same message', async () => {
  const pickupAt = new Date('2026-10-05T21:59:00.000Z')
  const missing = fakeTransaction({ pickupAt, missingSettings: true })
  await expect(suggestRosterVehicle(missing.transaction, rideId, driverId)).rejects.toBeInstanceOf(TenantSettingsMissingError)

  const sameWords = fakeTransaction({
    pickupAt,
    fail: { sql: 'from app.tenant_settings', message: 'Tenant settings are missing.' },
  })
  const wrapped = await suggestRosterVehicle(sameWords.transaction, rideId, driverId).catch(caught => caught)
  expect(wrapped).toMatchObject({ message: 'Ride read failed' })
  expect(wrapped).not.toBeInstanceOf(TenantSettingsMissingError)
})

it('keeps a roster input error from the pre-fill', async () => {
  const pickupAt = new Date('2026-10-05T21:59:00.000Z')
  const { transaction } = fakeTransaction({ pickupAt })
  transaction.execute = vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query)
    const text = compiled.sql
    if (text.includes('from app.rides'))
      return { rows: [{ id: rideId, pickupAt }] }
    if (text.includes('from app.drivers'))
      return { rows: [{ id: driverId }] }
    if (text.includes('from app.tenant_settings'))
      return { rows: [{ airport_wait_minutes: 90, elsewhere_wait_minutes: 25, time_zone: 'Europe/Zagreb', operational_day_start_hour: 5 }] }
    if (text.includes('from app.roster'))
      throw new RosterInputError()
    return { rows: [] }
  })
  await expect(suggestRosterVehicle(transaction, rideId, driverId)).rejects.toBeInstanceOf(RosterInputError)
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
  // The pre-fill does not take the assign share locks. It does not write a Ride.
  expect(beforeMidnight.queries.find(query => query.sql.includes('from app.drivers'))?.sql).not.toContain('for share')
  expect(beforeMidnight.queries.find(query => query.sql.includes('from app.vehicles'))?.sql).not.toContain('for share')

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
