import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { RosterInputError } from '../../../../shared'
import { createLogger, handleLoggedError } from '../../../core/index'
import { loadRosterDay, RosterDriverTakenError, RosterNotFoundError, RosterVehicleArchivedError, RosterVehicleTakenError, setRosterVehicle, vehicleIdForDriverOnDate } from './roster'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const day = '2026-10-05'
const dialect = new PgDialect()
const leak = 'Ana +385911234567 DU123AB'

interface RosterRow {
  id: string
  rosterDate: string
  driverId: string
  vehicleId: string
}

function row(partial: Partial<RosterRow> & Pick<RosterRow, 'driverId' | 'vehicleId'>): RosterRow {
  return {
    id: 'd1d1d1d1-1111-4111-8111-111111111111',
    rosterDate: day,
    ...partial,
  }
}

function fakeTransaction(
  world: {
    drivers: string[]
    vehicles: Array<{ id: string, archived: boolean }>
    rows: RosterRow[]
  },
  fail?: { code: string, message: string, constraint?: string },
) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  let next = 1
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (fail && (text.includes('insert into app.roster') || (text.includes('update app.roster') && !text.includes('for update')))) {
        const cause = Object.assign(new Error('duplicate'), {
          code: fail.code,
          constraint: fail.constraint,
        })
        throw Object.assign(new Error(`${fail.message} ${leak}`), { cause })
      }
      if (text.includes('audit.append_entry'))
        return { rows: [] }
      if (text.includes('app.drivers')) {
        const id = compiled.params[0]
        return { rows: world.drivers.filter(driver => driver === id).map(id => ({ id })) }
      }
      if (text.includes('app.vehicles')) {
        const id = compiled.params[0]
        const vehicle = world.vehicles.find(item => item.id === id)
        return { rows: vehicle ? [{ id: vehicle.id, archivedAt: vehicle.archived ? new Date('2026-10-01T00:00:00.000Z') : null }] : [] }
      }
      if (text.includes('delete from app.roster')) {
        const id = compiled.params[0]
        const index = world.rows.findIndex(item => item.id === id)
        if (index < 0)
          return { rows: [] }
        world.rows.splice(index, 1)
        return { rows: [{ id }] }
      }
      if (text.includes('insert into app.roster')) {
        const created = {
          id: `d0d0d0d0-0000-4000-8000-00000000000${next++}`,
          rosterDate: String(compiled.params[0]),
          driverId: String(compiled.params[1]),
          vehicleId: String(compiled.params[2]),
        }
        world.rows.push(created)
        return { rows: [created] }
      }
      if (text.includes('update app.roster')) {
        const id = compiled.params[1]
        const current = world.rows.find(item => item.id === id)
        if (!current)
          return { rows: [] }
        current.vehicleId = String(compiled.params[0])
        return { rows: [{ ...current }] }
      }
      if (text.includes('for update') && text.includes('<>')) {
        const rosterDate = String(compiled.params[0])
        const takenVehicleId = String(compiled.params[1])
        const exceptDriverId = String(compiled.params[2])
        return {
          rows: world.rows
            .filter(item => item.rosterDate === rosterDate && item.vehicleId === takenVehicleId && item.driverId !== exceptDriverId)
            .map(item => ({ id: item.id })),
        }
      }
      if (text.includes('for update')) {
        const rosterDate = String(compiled.params[0])
        const lockedDriverId = String(compiled.params[1])
        return { rows: world.rows.filter(item => item.rosterDate === rosterDate && item.driverId === lockedDriverId) }
      }
      if (text.includes('order by driver_id')) {
        const rosterDate = String(compiled.params[0])
        return {
          rows: world.rows
            .filter(item => item.rosterDate === rosterDate)
            .sort((left, right) => left.driverId.localeCompare(right.driverId))
            .map(item => ({ driverId: item.driverId, vehicleId: item.vehicleId })),
        }
      }
      if (text.includes('vehicle_id as')) {
        const lockedDriverId = String(compiled.params[0])
        const rosterDate = String(compiled.params[1])
        const found = world.rows.find(item => item.driverId === lockedDriverId && item.rosterDate === rosterDate)
        return { rows: found ? [{ vehicleId: found.vehicleId }] : [] }
      }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function auditPayloads(queries: Array<{ params: unknown[] }>): unknown[] {
  return queries
    .filter(query => typeof query.params[0] === 'string' && String(query.params[0]).startsWith('roster.'))
    .map(query => query.params[3])
}

function logLine(error: unknown): string {
  let line = ''
  const destination: Writable = new Writable({
    write(chunk, _encoding, callback) {
      line += String(chunk)
      callback()
    },
  })
  handleLoggedError(createLogger({ level: 'debug', destination }), error, 'req-roster')
  return line
}

const active = { drivers: [driverId, otherDriverId], vehicles: [{ id: vehicleId, archived: false }, { id: otherVehicleId, archived: false }] }

it('gives a Driver a Vehicle for the day and records ids, not a plate or a name', async () => {
  const world = { ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [] as RosterRow[] }
  const { transaction, queries } = fakeTransaction(world)
  await expect(setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  })).resolves.toEqual({ driverId, vehicleId })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ rosterDate: day, driverId, vehicleId }),
  ])
  expect(JSON.stringify(auditPayloads(queries))).not.toContain('registrationPlate')
  expect(JSON.stringify(auditPayloads(queries))).not.toContain('DU123AB')
  expect(queries.some(query => query.sql.includes('ride'))).toBe(false)
})

it('writes nothing when the same Vehicle is already on that Driver', async () => {
  const world = { ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [row({ driverId, vehicleId })] }
  const { transaction, queries } = fakeTransaction(world)
  await expect(setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  })).resolves.toEqual({ driverId, vehicleId })
  expect(auditPayloads(queries)).toEqual([])
  expect(queries.some(query => query.sql.includes('insert into app.roster') || query.sql.includes('update app.roster'))).toBe(false)
})

it('changes the Vehicle and records both ids', async () => {
  const world = { ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [row({ driverId, vehicleId })] }
  const { transaction, queries } = fakeTransaction(world)
  await expect(setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId: otherVehicleId,
  })).resolves.toEqual({ driverId, vehicleId: otherVehicleId })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({
      rosterDate: day,
      driverId,
      fromVehicleId: vehicleId,
      toVehicleId: otherVehicleId,
    }),
  ])
})

it('clears the day and records the Vehicle that was removed', async () => {
  const world = { ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [row({ driverId, vehicleId })] }
  const { transaction, queries } = fakeTransaction(world)
  await expect(setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId: null,
  })).resolves.toBeNull()
  expect(world.rows).toEqual([])
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ rosterDate: day, driverId, vehicleId }),
  ])
})

it('clears nothing when the Driver has no row that day', async () => {
  const world = { ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [] as RosterRow[] }
  const { transaction, queries } = fakeTransaction(world)
  await expect(setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId: null,
  })).resolves.toBeNull()
  expect(auditPayloads(queries)).toEqual([])
})

it('refuses an unknown Driver and an unknown or archived Vehicle before writing', async () => {
  const missingDriver = fakeTransaction({ drivers: [], vehicles: active.vehicles, rows: [] })
  await expect(setRosterVehicle(missingDriver.transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  })).rejects.toBeInstanceOf(RosterNotFoundError)
  expect(missingDriver.queries.some(query => query.sql.includes('insert into app.roster'))).toBe(false)

  const missingVehicle = fakeTransaction({ drivers: [driverId], vehicles: [], rows: [] })
  await expect(setRosterVehicle(missingVehicle.transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  })).rejects.toBeInstanceOf(RosterNotFoundError)

  const archived = fakeTransaction({
    drivers: [driverId],
    vehicles: [{ id: vehicleId, archived: true }],
    rows: [],
  })
  await expect(setRosterVehicle(archived.transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  })).rejects.toBeInstanceOf(RosterVehicleArchivedError)
  expect(archived.queries.some(query => query.sql.includes('insert into app.roster'))).toBe(false)
})

it('refuses a Vehicle already given to another Driver that day, and writes nothing', async () => {
  const world = {
    ...active,
    vehicles: active.vehicles.map(item => ({ ...item })),
    rows: [row({ id: 'd2d2d2d2-2222-4222-8222-222222222222', driverId: otherDriverId, vehicleId })],
  }
  const { transaction, queries } = fakeTransaction(world)
  await expect(setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  })).rejects.toBeInstanceOf(RosterVehicleTakenError)
  expect(world.rows).toHaveLength(1)
  expect(auditPayloads(queries)).toEqual([])
})

it('turns a vehicle-day unique violation into a conflict and drops the ids from the log', async () => {
  const { transaction } = fakeTransaction({ ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [] }, {
    code: '23505',
    constraint: 'roster_vehicle_day',
    message: 'duplicate key',
  })
  const error = await setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  }).catch(caught => caught)
  expect(error).toBeInstanceOf(RosterVehicleTakenError)
  expect(JSON.stringify(error)).not.toContain(leak)
  expect(logLine(error)).not.toContain('DU123AB')
  expect(logLine(error)).not.toContain('Ana')
})

it('turns a driver-day unique violation into a conflict', async () => {
  const { transaction } = fakeTransaction({ ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [] }, {
    code: '23505',
    constraint: 'roster_driver_day',
    message: 'duplicate key',
  })
  await expect(setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  })).rejects.toBeInstanceOf(RosterDriverTakenError)
})

it('replaces any other write failure so the log line does not keep a name or a plate', async () => {
  const { transaction } = fakeTransaction({ ...active, vehicles: active.vehicles.map(item => ({ ...item })), rows: [] }, {
    code: '22008',
    message: 'invalid input',
  })
  const error = await setRosterVehicle(transaction, actorUserId, {
    rosterDate: day,
    driverId,
    vehicleId,
  }).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Roster write failed' })
  expect(JSON.stringify(error)).not.toContain(leak)
  expect(logLine(error)).not.toContain(leak)
})

it('lists one day and looks up the Vehicle without reading a Ride', async () => {
  const rows = [
    row({ driverId, vehicleId }),
    row({
      id: 'd3d3d3d3-3333-4333-8333-333333333333',
      rosterDate: '2026-10-06',
      driverId,
      vehicleId: otherVehicleId,
    }),
  ]
  const listed = fakeTransaction({ drivers: [driverId], vehicles: [], rows })
  await expect(loadRosterDay(listed.transaction, day)).resolves.toEqual([{ driverId, vehicleId }])
  expect(listed.queries.some(query => query.sql.includes('ride'))).toBe(false)

  const lookup = fakeTransaction({ drivers: [], vehicles: [{ id: vehicleId, archived: true }], rows })
  await expect(vehicleIdForDriverOnDate(lookup.transaction, driverId, day)).resolves.toBe(vehicleId)
  expect(lookup.queries.some(query => query.sql.includes('app.vehicles') || query.sql.includes('ride'))).toBe(false)
  await expect(vehicleIdForDriverOnDate(lookup.transaction, otherDriverId, day)).resolves.toBeNull()
  await expect(vehicleIdForDriverOnDate(lookup.transaction, driverId, '2026-02-31')).rejects.toBeInstanceOf(RosterInputError)
})
