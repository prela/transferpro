import type { SQL } from 'drizzle-orm'
import type { Driver } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { Writable } from 'node:stream'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { DriverInputError } from '../../../../shared'
import { createLogger, handleLoggedError } from '../../../core/index'
import { TenantAccessError } from '../../tenancy'
import { addDriver, correctDriver, driverMustAcceptForAssign, DriverNotFoundError, loadDriverLinkedToMember, loadDrivers } from './drivers'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const driverId = '9e4b3f6d-5555-4555-8555-555555555555'
const memberUserId = '6b1e0c3a-2222-4222-8222-222222222222'
const phone = '+385911112222'
const dialect = new PgDialect()

const stored: Driver = {
  id: driverId,
  name: 'Marko Marić',
  kind: 'own',
  phone,
  drivingLicenceExpiresOn: '2027-06-01',
  transportLicenceExpiresOn: '2028-01-31',
  memberUserId: null,
  mustAccept: false,
}

function fakeTransaction(
  drivers: Driver[],
  members: Array<{ userId: string, role: string }> = [],
  fail?: { code: string, message: string, sql?: string },
) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (fail && text.includes(fail.sql ?? 'insert')) {
        // Drizzle puts the bound parameters on the outer error and the code on the cause.
        const cause = Object.assign(new Error('duplicate'), { code: fail.code, detail: `Failing row contains (${phone})` })
        throw Object.assign(new Error(fail.message), { cause })
      }
      if (text.includes('tenant_member')) {
        const userId = compiled.params[0]
        return { rows: members.filter(member => member.userId === userId).map(member => ({ role: member.role })) }
      }
      if (text.includes('insert')) {
        return {
          rows: [{
            id: driverId,
            name: compiled.params[0],
            kind: compiled.params[1],
            phone: compiled.params[2],
            drivingLicenceExpiresOn: compiled.params[3],
            transportLicenceExpiresOn: compiled.params[4],
            memberUserId: compiled.params[5],
            mustAccept: false,
          }],
        }
      }
      // `for update` contains the word update, so the lock is matched first.
      if (text.includes('for update')) {
        const id = compiled.params[0]
        return { rows: drivers.filter(row => row.id === id) }
      }
      if (text.includes('update'))
        return { rows: [] }
      if (text.includes('drivers')) {
        // A linked-member read binds the member id. The office list does not.
        if (text.includes('member_user_id =')) {
          const memberId = compiled.params[0]
          return { rows: drivers.filter(row => row.memberUserId === memberId) }
        }
        return { rows: drivers }
      }
      return { rows: [] }
    }),
  }
  return { transaction, queries }
}

function auditPayloads(queries: Array<{ params: unknown[] }>): unknown[] {
  return queries
    .filter(query => typeof query.params[0] === 'string' && String(query.params[0]).startsWith('driver.'))
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
  handleLoggedError(createLogger({ level: 'debug', destination }), error, 'req-driver')
  return line
}

const input = {
  name: 'Marko Marić',
  kind: 'own' as const,
  phone,
  drivingLicenceExpiresOn: '2027-06-01',
  transportLicenceExpiresOn: '2028-01-31',
}

it('adds a Driver with no account and records field names, not the phone or the dates', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(addDriver(transaction, actorUserId, input)).resolves.toEqual(stored)
  const created = auditPayloads(queries)
  expect(created).toEqual([
    JSON.stringify({
      driverId,
      fields: ['name', 'kind', 'phone', 'drivingLicenceExpiresOn', 'transportLicenceExpiresOn'],
    }),
  ])
  expect(JSON.stringify(created)).not.toContain(phone)
  expect(JSON.stringify(created)).not.toContain('2027-06-01')
  expect(JSON.stringify(created)).not.toContain('Marko')
})

it('adds a Driver linked to a driver member and names that field', async () => {
  const { transaction, queries } = fakeTransaction([], [{ userId: memberUserId, role: 'driver' }])
  const added = await addDriver(transaction, actorUserId, { ...input, memberUserId })
  expect(added.memberUserId).toBe(memberUserId)
  expect(auditPayloads(queries)[0]).toContain('memberUserId')
  expect(JSON.stringify(auditPayloads(queries))).not.toContain(phone)
})

it('refuses a member who is not a driver, and a member the session cannot see', async () => {
  const dispatcher = fakeTransaction([], [{ userId: memberUserId, role: 'dispatcher' }])
  await expect(addDriver(dispatcher.transaction, actorUserId, { ...input, memberUserId })).rejects.toBeInstanceOf(DriverInputError)
  expect(auditPayloads(dispatcher.queries)).toEqual([])

  const otherTenant = fakeTransaction([], [])
  await expect(addDriver(otherTenant.transaction, actorUserId, { ...input, memberUserId })).rejects.toBeInstanceOf(DriverInputError)
  expect(otherTenant.queries.some(query => query.sql.includes('insert'))).toBe(false)
})

it('drops a database error that carries the phone, so the log line does not', async () => {
  const { transaction } = fakeTransaction([], [{ userId: memberUserId, role: 'driver' }], {
    code: '23505',
    message: `duplicate key ${phone}`,
  })
  const error = await addDriver(transaction, actorUserId, { ...input, memberUserId }).catch(caught => caught)
  expect(error).toBeInstanceOf(DriverInputError)
  expect(error).toMatchObject({ message: 'Bad request', statusCode: 400 })
  expect(JSON.stringify(error)).not.toContain(phone)
  expect(logLine(error)).not.toContain(phone)
  expect(logLine(error)).not.toContain('2027-06-01')
})

it('replaces any other write failure so the log line does not keep the phone', async () => {
  const { transaction } = fakeTransaction([], [], {
    code: '22008',
    message: `invalid input ${phone}`,
  })
  const error = await addDriver(transaction, actorUserId, input).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Driver write failed' })
  expect(error).not.toBeInstanceOf(DriverInputError)
  expect(String(error)).not.toContain(phone)
  expect(logLine(error)).not.toContain(phone)
})

it('lists the Drivers the session returned', async () => {
  const { transaction } = fakeTransaction([stored])
  await expect(loadDrivers(transaction)).resolves.toEqual([stored])
})

it('returns only the Driver linked to the given member', async () => {
  const linked = { ...stored, memberUserId }
  const otherId = '8d3a2e5c-4444-4444-8444-444444444444'
  const other = { ...stored, id: otherId, name: 'Boris Kovač', memberUserId: '5a0d9b29-1111-4111-8111-111111111111' }
  const { transaction } = fakeTransaction([other, linked])
  await expect(loadDriverLinkedToMember(transaction, memberUserId)).resolves.toEqual([linked])
  await expect(loadDrivers(transaction)).resolves.toEqual([other, linked])
})

it('records each corrected field by name, and not the phone or the date', async () => {
  const { transaction, queries } = fakeTransaction([stored])
  await expect(correctDriver(transaction, actorUserId, 'dispatcher', driverId, {
    name: 'Mara Marić',
    phone: '+385911110000',
    drivingLicenceExpiresOn: '2029-03-03',
    kind: 'external',
  })).resolves.toMatchObject({
    name: 'Mara Marić',
    phone: '+385911110000',
    kind: 'external',
    drivingLicenceExpiresOn: '2029-03-03',
  })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ driverId, field: 'name' }),
    JSON.stringify({ driverId, field: 'kind' }),
    JSON.stringify({ driverId, field: 'phone' }),
    JSON.stringify({ driverId, field: 'drivingLicenceExpiresOn' }),
  ])
  const text = JSON.stringify(auditPayloads(queries))
  expect(text).not.toContain(phone)
  expect(text).not.toContain('+385911110000')
  expect(text).not.toContain('2029-03-03')
  expect(text).not.toContain('Mara')
})

it('writes nothing when the correction matches the row', async () => {
  const { transaction, queries } = fakeTransaction([stored])
  await expect(correctDriver(transaction, actorUserId, 'admin', driverId, { name: stored.name, phone })).resolves.toEqual(stored)
  expect(queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(queries)).toEqual([])
})

it('lets an admin change must-accept and refuses a dispatcher before any write', async () => {
  const admin = fakeTransaction([stored])
  await expect(correctDriver(admin.transaction, actorUserId, 'admin', driverId, { mustAccept: true })).resolves.toMatchObject({
    mustAccept: true,
  })
  expect(auditPayloads(admin.queries)).toEqual([
    JSON.stringify({ driverId, field: 'mustAccept' }),
  ])

  const dispatcher = fakeTransaction([stored])
  await expect(correctDriver(dispatcher.transaction, actorUserId, 'dispatcher', driverId, {
    name: 'Mara Marić',
    mustAccept: true,
  })).rejects.toBeInstanceOf(TenantAccessError)
  expect(dispatcher.queries.filter(query => query.sql.includes('update') && !query.sql.includes('for update'))).toEqual([])
  expect(auditPayloads(dispatcher.queries)).toEqual([])
})

it('clears a member link and refuses a second shape that is not a driver', async () => {
  const linked = { ...stored, memberUserId }
  const { transaction, queries } = fakeTransaction([linked])
  await expect(correctDriver(transaction, actorUserId, 'dispatcher', driverId, {
    memberUserId: null,
  })).resolves.toMatchObject({ memberUserId: null })
  expect(auditPayloads(queries)).toEqual([
    JSON.stringify({ driverId, field: 'memberUserId' }),
  ])

  const taken = fakeTransaction([stored], [{ userId: memberUserId, role: 'admin' }])
  await expect(correctDriver(taken.transaction, actorUserId, 'admin', driverId, {
    memberUserId,
  })).rejects.toBeInstanceOf(DriverInputError)
})

it('does not find a Driver the session cannot see', async () => {
  const { transaction, queries } = fakeTransaction([])
  await expect(correctDriver(transaction, actorUserId, 'admin', driverId, { kind: 'external' })).rejects.toBeInstanceOf(DriverNotFoundError)
  expect(auditPayloads(queries)).toEqual([])
})

it('replaces an assign read failure so the log line does not keep the driver id', async () => {
  const { transaction } = fakeTransaction([], [], {
    code: '57014',
    message: `cancel ${driverId}`,
    sql: 'for share',
  })
  const error = await driverMustAcceptForAssign(transaction, driverId).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Driver read failed' })
  expect(String(error)).not.toContain(driverId)
  expect(logLine(error)).not.toContain(driverId)
})
