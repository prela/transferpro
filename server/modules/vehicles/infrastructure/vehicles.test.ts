import type { SQL } from 'drizzle-orm'
import type { Vehicle } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { VehicleInputError } from '../../../../shared'
import { createLogger, handleLoggedError } from '../../../core/index'
import { addVehicle, archiveStoredVehicle, correctVehicle, loadVehicles, VehicleConflictError, VehicleNotFoundError } from './vehicles'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const vehicleId = 'a1b2c3d4-5555-4555-8555-555555555555'
const plate = 'DU123AB'
const dialect = new PgDialect()

const stored: Vehicle = {
  id: vehicleId,
  registrationPlate: plate,
  kind: 'fixed',
  registrationExpiresOn: '2027-06-01',
  technicalInspectionExpiresOn: '2028-01-31',
  insuranceExpiresOn: '2029-03-03',
  description: null,
  archivedAt: null,
}

function fakeTransaction(
  vehicles: Vehicle[],
  fail?: { code: string, message: string, constraint?: string },
) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (fail && (text.includes('insert') || (text.includes('update') && !text.includes('for update')))) {
        const cause = Object.assign(new Error('duplicate'), {
          code: fail.code,
          constraint: fail.constraint,
          detail: `Failing row contains (${plate})`,
        })
        throw Object.assign(new Error(fail.message), { cause })
      }
      if (text.includes('insert')) {
        return {
          rows: [{
            id: vehicleId,
            registrationPlate: compiled.params[0],
            kind: compiled.params[1],
            registrationExpiresOn: compiled.params[2],
            technicalInspectionExpiresOn: compiled.params[3],
            insuranceExpiresOn: compiled.params[4],
            description: compiled.params[5] ?? null,
            archivedAt: null,
          }],
        }
      }
      if (text.includes('for update')) {
        const id = compiled.params[0]
        return { rows: vehicles.filter(row => row.id === id) }
      }
      if (text.includes('update') && text.includes('archived_at')) {
        const archived = { ...vehicles[0]!, archivedAt: new Date('2026-10-05T10:00:00.000Z') }
        return { rows: [archived] }
      }
      if (text.includes('update'))
        return { rows: [] }
      if (text.includes('vehicles'))
        return { rows: vehicles }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function auditPayloads(queries: Array<{ params: unknown[] }>): unknown[] {
  return queries
    .filter(query => typeof query.params[0] === 'string' && String(query.params[0]).startsWith('vehicle.'))
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
  handleLoggedError(createLogger({ level: 'debug', destination }), error, 'req-vehicle')
  return line
}

const input = {
  registrationPlate: plate,
  kind: 'fixed' as const,
  registrationExpiresOn: '2027-06-01',
  technicalInspectionExpiresOn: '2028-01-31',
  insuranceExpiresOn: '2029-03-03',
  description: null,
}

it('adds a Vehicle and records field names, not the plate or the dates', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(addVehicle(transaction, actorUserId, input)).resolves.toEqual(stored)
  const created = auditPayloads(queries)
  expect(created).toEqual([
    JSON.stringify({
      vehicleId,
      fields: ['registrationPlate', 'kind', 'registrationExpiresOn', 'technicalInspectionExpiresOn', 'insuranceExpiresOn'],
    }),
  ])
  expect(JSON.stringify(created)).not.toContain(plate)
  expect(JSON.stringify(created)).not.toContain('2027-06-01')
})

it('drops a live-plate unique violation so the log line does not keep the plate', async () => {
  const { transaction } = fakeTransaction([], {
    code: '23505',
    constraint: 'vehicles_plate_active',
    message: `duplicate key ${plate} vehicles_plate_active`,
  })
  const error = await addVehicle(transaction, actorUserId, input).catch(caught => caught)
  expect(error).toBeInstanceOf(VehicleConflictError)
  expect(error).toMatchObject({ message: 'Conflict', statusCode: 409 })
  expect(JSON.stringify(error)).not.toContain(plate)
  expect(logLine(error)).not.toContain(plate)
})

it('replaces any other write failure so the log line does not keep the plate', async () => {
  const { transaction } = fakeTransaction([], {
    code: '22008',
    message: `invalid input ${plate}`,
  })
  const error = await addVehicle(transaction, actorUserId, input).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Vehicle write failed' })
  expect(error).not.toBeInstanceOf(VehicleInputError)
  expect(String(error)).not.toContain(plate)
  expect(logLine(error)).not.toContain(plate)
})

it('lists the Vehicles the session returned', async () => {
  const { transaction } = fakeTransaction([stored])
  await expect(loadVehicles(transaction, false)).resolves.toEqual([stored])
})

it('records each corrected field by name, and not the plate or the date', async () => {
  const { transaction, queries } = fakeTransaction([stored])
  await expect(correctVehicle(transaction, actorUserId, vehicleId, {
    registrationPlate: 'ZG111AA',
    kind: 'occasional',
    registrationExpiresOn: '2030-04-04',
  })).resolves.toMatchObject({
    registrationPlate: 'ZG111AA',
    kind: 'occasional',
    registrationExpiresOn: '2030-04-04',
  })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ vehicleId, field: 'registrationPlate' }),
    JSON.stringify({ vehicleId, field: 'kind' }),
    JSON.stringify({ vehicleId, field: 'registrationExpiresOn' }),
  ])
  const text = JSON.stringify(auditPayloads(queries))
  expect(text).not.toContain(plate)
  expect(text).not.toContain('ZG111AA')
  expect(text).not.toContain('2030-04-04')
})

it('writes nothing when the correction matches the row', async () => {
  const { transaction, queries } = fakeTransaction([stored])
  await expect(correctVehicle(transaction, actorUserId, vehicleId, { registrationPlate: plate })).resolves.toEqual(stored)
  expect(queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(queries)).toEqual([])
})

it('archives a Vehicle without storing the plate, and a second archive writes nothing', async () => {
  const { transaction, queries } = fakeTransaction([stored])
  const archived = await archiveStoredVehicle(transaction, actorUserId, vehicleId)
  expect(archived.archivedAt).toBe('2026-10-05T10:00:00.000Z')
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ vehicleId }),
  ])
  expect(JSON.stringify(auditPayloads(queries))).not.toContain(plate)

  const already = fakeTransaction([{ ...stored, archivedAt: '2026-10-05T10:00:00.000Z' }])
  await expect(archiveStoredVehicle(already.transaction, actorUserId, vehicleId)).resolves.toMatchObject({
    archivedAt: '2026-10-05T10:00:00.000Z',
  })
  expect(already.queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(already.queries)).toEqual([])
})

it('does not find a Vehicle the session cannot see', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(correctVehicle(transaction, actorUserId, vehicleId, { kind: 'occasional' })).rejects.toBeInstanceOf(VehicleNotFoundError)
  expect(auditPayloads(queries)).toEqual([])
})

it('refuses a correction of an archived Vehicle and writes nothing', async () => {
  const archived = { ...stored, archivedAt: '2026-10-05T10:00:00.000Z' }
  const { transaction, queries } = fakeTransaction([archived])
  await expect(correctVehicle(transaction, actorUserId, vehicleId, { kind: 'occasional' })).rejects.toBeInstanceOf(VehicleConflictError)
  expect(queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(queries)).toEqual([])
})

it('records a description by field name, not the text', async () => {
  const note = 'Mercedes Vito 8+1, crni'
  const { transaction, queries } = fakeTransaction([])
  await expect(addVehicle(transaction, actorUserId, { ...input, description: note })).resolves.toMatchObject({
    description: note,
  })
  expect(auditPayloads(queries)[0]).toContain('description')
  expect(JSON.stringify(auditPayloads(queries))).not.toContain(note)
})
