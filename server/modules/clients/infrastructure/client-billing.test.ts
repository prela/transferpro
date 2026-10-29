import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { StaleSaveError } from '../../../../shared'
import { TenantAccessError } from '../../tenancy'
import { loadClientBillingDetails, saveClientBilling } from './client-billing'
import { ClientNotFoundError } from './clients'

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const billingId = '1d2c3b4a-6666-4666-8666-666666666666'
const dialect = new PgDialect()
const savedAt = new Date('2026-10-29T08:00:00.000Z')
const legalName = 'Hotel Jadran d.o.o.'
const address = 'Obala 1, Split'
const oib = '12345678903'

const firstSave = {
  legalName,
  country: 'HR' as const,
  oib,
  vatId: null,
  address,
  guestNameOnInvoice: false,
}

interface Stored {
  clientId: string
  legalName: string
  country: 'HR' | 'DE'
  oib: string | null
  vatId: string | null
  address: string
  guestNameOnInvoice: boolean
  version: number
  changedAt: Date | null
  changedByName: string | null
}

function fakeTransaction(options: { client?: boolean, stored?: Stored | null, race?: boolean, claimed?: boolean } = {}) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  let stored = options.stored === undefined ? null : options.stored
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      const text = compiled.sql
      if (text.includes('from app.clients'))
        return { rows: options.client === false ? [] : [{ id: clientId }] }
      if (text.includes('insert into app.client_billing_details')) {
        if (options.race)
          throw Object.assign(new Error('duplicate billing details'), { code: '23505' })
        stored = {
          clientId,
          legalName: compiled.params[1] as string,
          country: compiled.params[2] as 'HR',
          oib: compiled.params[3] as string | null,
          vatId: compiled.params[4] as string | null,
          address: compiled.params[5] as string,
          guestNameOnInvoice: compiled.params[6] as boolean,
          version: 1,
          changedAt: savedAt,
          changedByName: 'Dino Dispatcher',
        }
        return { rows: [{ id: billingId }] }
      }
      if (text.includes('for update'))
        return { rows: stored ? [stored] : [] }
      if (text.includes('update app.client_billing_details')) {
        if (options.claimed === false || !stored)
          return { rows: [] }
        stored = {
          ...stored,
          legalName: compiled.params[0] as string,
          country: compiled.params[1] as 'HR' | 'DE',
          oib: compiled.params[2] as string | null,
          vatId: compiled.params[3] as string | null,
          address: compiled.params[4] as string,
          guestNameOnInvoice: compiled.params[5] as boolean,
          version: stored.version + 1,
          changedAt: savedAt,
          changedByName: 'Hana Admin',
        }
        return { rows: [{ id: billingId }] }
      }
      if (text.includes('from app.client_billing_details'))
        return { rows: stored ? [stored] : [] }
      return { rows: [] }
    }),
  }
  return { transaction, queries, read: () => stored }
}

function auditParams(queries: Array<{ params: unknown[] }>, action: string): unknown {
  return queries.find(query => query.params[0] === action)?.params[3]
}

it('saves the first billing details at version 1 and records field names, not values', async () => {
  const { transaction, queries } = fakeTransaction()
  await expect(saveClientBilling(transaction, actorUserId, clientId, firstSave)).resolves.toEqual({
    clientId,
    ...firstSave,
    complete: true,
    version: 1,
    changedAt: '2026-10-29T08:00:00.000Z',
    changedByName: 'Dino Dispatcher',
  })
  expect(auditParams(queries, 'billing_details.saved')).toBe(JSON.stringify({
    clientId,
    fields: ['legalName', 'country', 'oib', 'address'],
  }))
  const audit = queries.find(query => query.params[0] === 'billing_details.saved')
  const text = JSON.stringify(audit?.params)
  expect(text).not.toContain(legalName)
  expect(text).not.toContain(oib)
  expect(text).not.toContain(address)
  expect(queries.some(query => query.sql.includes('update app.clients'))).toBe(false)
})

it('reads no row as incomplete, and a missing Client as not found', async () => {
  const empty = fakeTransaction()
  await expect(loadClientBillingDetails(empty.transaction, clientId, 'dispatcher')).resolves.toEqual({
    clientId,
    legalName: null,
    country: null,
    oib: null,
    vatId: null,
    address: null,
    guestNameOnInvoice: false,
    complete: false,
    version: null,
    changedAt: null,
    changedByName: null,
  })
  expect(empty.queries.some(query => query.sql.includes('client_billing_details'))).toBe(true)
  const driver = fakeTransaction()
  await expect(loadClientBillingDetails(driver.transaction, clientId, 'driver')).rejects.toBeInstanceOf(TenantAccessError)
  expect(driver.queries).toEqual([])
  const missing = fakeTransaction({ client: false })
  await expect(saveClientBilling(missing.transaction, actorUserId, clientId, firstSave)).rejects.toBeInstanceOf(ClientNotFoundError)
  expect(missing.queries.some(query => query.sql.includes('insert'))).toBe(false)
})

it('a second first save that loses the race writes nothing and appends nothing', async () => {
  const { transaction, queries } = fakeTransaction({ race: true })
  await expect(saveClientBilling(transaction, actorUserId, clientId, firstSave)).rejects.toBeInstanceOf(StaleSaveError)
  expect(auditParams(queries, 'billing_details.saved')).toBeUndefined()
  expect(queries.some(query => query.sql.includes('update app.clients'))).toBe(false)
})

it('refuses a stale correction, including one that would change nothing, and writes nothing', async () => {
  const stored: Stored = {
    clientId,
    ...firstSave,
    version: 2,
    changedAt: savedAt,
    changedByName: 'Dino Dispatcher',
  }
  const change = fakeTransaction({ stored })
  await expect(saveClientBilling(change.transaction, actorUserId, clientId, {
    ...firstSave,
    address: 'Nova adresa 2',
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(change.queries.some(query => query.sql.includes('update app.client_billing_details'))).toBe(false)
  expect(auditParams(change.queries, 'billing_details.saved')).toBeUndefined()

  const same = fakeTransaction({ stored })
  await expect(saveClientBilling(same.transaction, actorUserId, clientId, {
    ...firstSave,
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(same.queries.some(query => query.sql.includes('update app.client_billing_details'))).toBe(false)
})

it('a version for billing details that are not there is a stale save', async () => {
  const { transaction, queries } = fakeTransaction()
  await expect(saveClientBilling(transaction, actorUserId, clientId, {
    ...firstSave,
    version: 1,
  })).rejects.toBeInstanceOf(StaleSaveError)
  expect(queries.some(query => query.sql.includes('update app.client_billing_details'))).toBe(false)
  expect(auditParams(queries, 'billing_details.saved')).toBeUndefined()
})

it('writes nothing when a fresh save matches the stored details', async () => {
  const stored: Stored = {
    clientId,
    ...firstSave,
    version: 4,
    changedAt: savedAt,
    changedByName: 'Dino Dispatcher',
  }
  const { transaction, queries } = fakeTransaction({ stored })
  await expect(saveClientBilling(transaction, actorUserId, clientId, { ...firstSave, version: 4 })).resolves.toMatchObject({
    version: 4,
    complete: true,
    changedByName: 'Dino Dispatcher',
  })
  expect(queries.some(query => query.sql.includes('update app.client_billing_details'))).toBe(false)
  expect(auditParams(queries, 'billing_details.saved')).toBeUndefined()
})

it('corrects the address and records that field name, not the new address', async () => {
  const next = 'Nova obala 2, Split'
  const stored: Stored = {
    clientId,
    ...firstSave,
    version: 1,
    changedAt: savedAt,
    changedByName: 'Dino Dispatcher',
  }
  const { transaction, queries } = fakeTransaction({ stored })
  await expect(saveClientBilling(transaction, actorUserId, clientId, {
    ...firstSave,
    address: next,
    version: 1,
  })).resolves.toMatchObject({
    address: next,
    version: 2,
    changedByName: 'Hana Admin',
    complete: true,
  })
  expect(auditParams(queries, 'billing_details.saved')).toBe(JSON.stringify({ clientId, fields: ['address'] }))
  expect(JSON.stringify(queries.find(query => query.params[0] === 'billing_details.saved')?.params)).not.toContain(next)
  expect(queries.some(query => query.sql.includes('update app.clients'))).toBe(false)
})

it('a foreign Client with no OIB is complete', async () => {
  const { transaction } = fakeTransaction()
  await expect(saveClientBilling(transaction, actorUserId, clientId, {
    legalName: 'Alpine GmbH',
    country: 'DE',
    oib: null,
    vatId: null,
    address: 'Hauptstr. 1',
    guestNameOnInvoice: true,
  })).resolves.toMatchObject({
    country: 'DE',
    oib: null,
    guestNameOnInvoice: true,
    complete: true,
    version: 1,
  })
})
