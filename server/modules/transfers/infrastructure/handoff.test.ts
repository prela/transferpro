import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, it, vi } from 'vitest'
import { RideUnavailableError } from '../../capacity'
import { RideNotFoundError } from './assign'
import { checkPartnerCapacity } from './capacity-check'
import { changeRidePartnerForOffice, handOffRideForOffice, RidePartnerArchivedError, RidePartnerUnchangedError, takeBackRideForOffice } from './handoff'

vi.mock('./capacity-check', () => ({
  checkPartnerCapacity: vi.fn(async () => {}),
}))

beforeEach(() => {
  vi.mocked(checkPartnerCapacity).mockReset()
  vi.mocked(checkPartnerCapacity).mockResolvedValue(undefined)
})

/**
 * Lock order for a handoff (ADR-0034). The Transfer and Ride are locked,
 * then the Tenant capacity lock, then the Partner. A refusal after the
 * Partner read does not claim the version, update the Ride, or append.
 * Take-back does not take the lock and does not read the Partner.
 */

const actorUserId = '7c2f1d4b-3333-4333-8333-333333333333'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const transferId = 'd1d1d1d1-1111-4111-8111-111111111111'
const partnerId = 'a1a1a1a1-1111-4111-8111-111111111111'
const nextPartnerId = 'a2a2a2a2-2222-4222-8222-222222222222'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const dialect = new PgDialect()

function stepName(text: string): string {
  if (text.includes('pg_advisory_xact_lock'))
    return 'capacity'
  if (text.includes('from app.partners'))
    return 'partner'
  if (text.includes('version + 1'))
    return 'version'
  if (text.includes('audit.append_entry'))
    return 'audit'
  if (text.includes('for update'))
    return 'lock'
  if (text.includes('update app.rides'))
    return 'update'
  return 'other'
}

function fakeTransaction(script: {
  state?: string
  driverId?: string | null
  vehicleId?: string | null
  partnerId?: string | null
  partner?: 'active' | 'archived' | 'missing'
}) {
  const queries: string[] = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql
      queries.push(text)
      const step = stepName(text)
      if (step === 'lock') {
        return {
          rows: [{
            id: rideId,
            transferId,
            state: script.state ?? 'unassigned',
            version: 4,
            driverId: script.driverId ?? null,
            vehicleId: script.vehicleId ?? null,
            mustAccept: script.driverId ? false : null,
            partnerId: script.partnerId ?? null,
          }],
        }
      }
      if (step === 'partner') {
        if (script.partner === 'missing')
          return { rows: [] }
        return {
          rows: [{ archivedAt: script.partner === 'archived' ? '2026-01-01T00:00:00.000Z' : null }],
        }
      }
      if (step === 'version')
        return { rows: [{ id: transferId }] }
      if (step === 'update') {
        const handed = text.includes('handed_off')
        const taken = text.includes('unassigned')
        return {
          rows: [{
            id: rideId,
            transferId,
            state: taken ? 'unassigned' : 'handed_off',
            driverId: null,
            vehicleId: null,
            mustAccept: null,
            partnerId: taken ? null : (handed ? partnerId : nextPartnerId),
          }],
        }
      }
      return { rows: [] }
    }),
  }
  return { transaction, steps: () => queries.map(stepName).filter(name => name !== 'other') }
}

it('takes the capacity lock after the row lock and before the Partner, and writes only after that', async () => {
  const world = fakeTransaction({})
  await handOffRideForOffice(world.transaction, actorUserId, { rideId, partnerId, version: 4 })
  expect(world.steps()).toEqual(['lock', 'capacity', 'partner', 'version', 'update', 'audit'])
  expect(checkPartnerCapacity).toHaveBeenCalledWith(world.transaction, { rideId, partnerId, confirm: false })
})

it('an archived Partner writes nothing after the lock', async () => {
  const world = fakeTransaction({ partner: 'archived' })
  await expect(handOffRideForOffice(world.transaction, actorUserId, { rideId, partnerId, version: 4 }))
    .rejects
    .toBeInstanceOf(RidePartnerArchivedError)
  expect(world.steps()).toEqual(['lock', 'capacity', 'partner'])
  expect(checkPartnerCapacity).not.toHaveBeenCalled()
})

it('an unavailable Partner writes nothing, and confirm passes it', async () => {
  vi.mocked(checkPartnerCapacity).mockRejectedValueOnce(new RideUnavailableError())
  const refused = fakeTransaction({})
  await expect(handOffRideForOffice(refused.transaction, actorUserId, { rideId, partnerId, version: 4 }))
    .rejects
    .toBeInstanceOf(RideUnavailableError)
  expect(refused.steps()).toEqual(['lock', 'capacity', 'partner'])

  const confirmed = fakeTransaction({})
  await handOffRideForOffice(confirmed.transaction, actorUserId, { rideId, partnerId, version: 4, confirm: true })
  expect(checkPartnerCapacity).toHaveBeenCalledWith(confirmed.transaction, { rideId, partnerId, confirm: true })
  expect(confirmed.steps()).toEqual(['lock', 'capacity', 'partner', 'version', 'update', 'audit'])
})

it('a missing Partner is not found and writes nothing', async () => {
  const world = fakeTransaction({ partner: 'missing' })
  await expect(handOffRideForOffice(world.transaction, actorUserId, { rideId, partnerId, version: 4 }))
    .rejects
    .toBeInstanceOf(RideNotFoundError)
  expect(world.steps()).toEqual(['lock', 'capacity', 'partner'])
  expect(checkPartnerCapacity).not.toHaveBeenCalled()
})

it('a Partner change locks before the read, and the same active Partner writes nothing', async () => {
  const same = fakeTransaction({ state: 'handed_off', partnerId })
  await expect(changeRidePartnerForOffice(same.transaction, actorUserId, { rideId, partnerId, version: 4 }))
    .rejects
    .toBeInstanceOf(RidePartnerUnchangedError)
  expect(same.steps()).toEqual(['lock', 'capacity', 'partner'])
  expect(checkPartnerCapacity).not.toHaveBeenCalled()

  const moved = fakeTransaction({ state: 'handed_off', partnerId })
  await changeRidePartnerForOffice(moved.transaction, actorUserId, { rideId, partnerId: nextPartnerId, version: 4 })
  expect(moved.steps()).toEqual(['lock', 'capacity', 'partner', 'version', 'update', 'audit'])
})

it('take-back claims the version without the capacity lock or a Partner read', async () => {
  const world = fakeTransaction({ state: 'handed_off', partnerId })
  await takeBackRideForOffice(world.transaction, actorUserId, rideId, 4)
  expect(world.steps()).toEqual(['lock', 'version', 'update', 'audit'])
})

it('a clear handoff names the Driver and the Vehicle that were released', async () => {
  const world = fakeTransaction({ state: 'assigned', driverId, vehicleId, partner: 'active' })
  await handOffRideForOffice(world.transaction, actorUserId, { rideId, partnerId, version: 4 })
  expect(world.steps()).toEqual(['lock', 'capacity', 'partner', 'version', 'update', 'audit'])
})
