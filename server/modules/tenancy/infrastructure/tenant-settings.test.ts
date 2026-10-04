import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { changeTenantSettings, loadTenantSettings } from './tenant-settings'

/**
 * `US/Eastern` is an alias Intl can format and `supportedValuesOf` omits.
 * A row written under an older list must still load. A new zone is checked.
 */
const retiredZone = 'US/Eastern'
const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const dialect = new PgDialect()

function fakeTransaction(timeZone: string) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query))
      return {
        rows: [{
          airport_wait_minutes: 90,
          elsewhere_wait_minutes: 25,
          time_zone: timeZone,
        }],
      }
    }),
  }
  return { transaction, queries }
}

it('reads a stored zone that is no longer on the runtime list', async () => {
  const { transaction } = fakeTransaction(retiredZone)
  await expect(loadTenantSettings(transaction)).resolves.toEqual({
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
    timeZone: retiredZone,
  })
})

it('keeps that zone when another field changes, and records only the field that changed', async () => {
  const { transaction, queries } = fakeTransaction(retiredZone)
  await expect(changeTenantSettings(transaction, actorUserId, { airportWaitMinutes: 100 })).resolves.toEqual({
    airportWaitMinutes: 100,
    elsewhereWaitMinutes: 25,
    timeZone: retiredZone,
  })
  const actions = queries.map(query => query.params[0]).filter(param => typeof param === 'string' && param.startsWith('settings.'))
  expect(actions).toEqual(['settings.airport_wait_changed'])
})

it('refuses to write a zone the list does not include, and accepts a listed zone in its place', async () => {
  const refused = fakeTransaction('Europe/Zagreb')
  await expect(changeTenantSettings(refused.transaction, actorUserId, { timeZone: retiredZone })).rejects.toThrow()
  expect(refused.queries.map(query => query.params[0])).not.toContain('settings.time_zone_changed')

  const { transaction, queries } = fakeTransaction(retiredZone)
  await expect(changeTenantSettings(transaction, actorUserId, { timeZone: 'Europe/Berlin' })).resolves.toEqual({
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
    timeZone: 'Europe/Berlin',
  })
  const zoneWrite = queries.find(query => query.params[0] === 'settings.time_zone_changed')
  expect(zoneWrite?.params[3]).toBe(JSON.stringify({ from: retiredZone, to: 'Europe/Berlin' }))
})
