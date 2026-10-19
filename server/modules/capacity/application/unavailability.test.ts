import { describe, expect, it } from 'vitest'
import { fakeUnavailabilityPorts, NEW_WINDOW_ID } from '../testing'
import {
  changeUnavailability,
  listUnavailabilityDuring,
  listUnavailabilityOf,
  recordUnavailability,
  removeUnavailability,
} from './unavailability'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const windowId = 'a1a1a1a1-1111-4111-8111-111111111111'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const laterRideId = 'e2e2e2e2-3333-4333-8333-333333333333'

function at(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 9, 20, hours, minutes))
}

function iso(hours: number, minutes = 0): string {
  return at(hours, minutes).toISOString()
}

const driverWindow = { id: windowId, driverId, vehicleId: null, startsAt: at(10), endsAt: at(12) }

function ride(id: string, pickupAt: Date) {
  return { rideId: id, driverId, vehicleId: otherVehicleId, partnerId: null, pickupAt, landingAt: null }
}

const record = { resource: { kind: 'driver' as const, id: driverId }, startsAt: iso(10), endsAt: iso(12) }

describe('recordUnavailability', () => {
  it('refuses a Driver role before it locks or reads anything', async () => {
    const fake = fakeUnavailabilityPorts()
    await expect(recordUnavailability(fake.ports, 'driver', record)).rejects.toMatchObject({ statusCode: 403 })
    expect(fake.calls).toEqual([])
  })

  it('takes the Tenant lock before it reads the Driver, then writes and audits ids and field names only', async () => {
    const fake = fakeUnavailabilityPorts()
    const saved = await recordUnavailability(fake.ports, 'dispatcher', record)
    expect(fake.calls).toEqual(['lock', 'presence:driver', 'insert', 'audit', 'minutes', 'ridesDuring'])
    expect(saved.window).toEqual({ id: NEW_WINDOW_ID, driverId, vehicleId: null, startsAt: iso(10), endsAt: iso(12) })
    expect(fake.audits).toEqual([{
      action: 'unavailability.added',
      windowId: NEW_WINDOW_ID,
      driverId,
      vehicleId: null,
      fields: ['startsAt', 'endsAt'],
    }])
  })

  it('records a Vehicle window for an Admin', async () => {
    const fake = fakeUnavailabilityPorts()
    const saved = await recordUnavailability(fake.ports, 'admin', { ...record, resource: { kind: 'vehicle', id: vehicleId } })
    expect(fake.calls[1]).toBe('presence:vehicle')
    expect(saved.window).toMatchObject({ driverId: null, vehicleId })
    expect(fake.audits[0]).toMatchObject({ driverId: null, vehicleId })
  })

  it.each([
    ['missing', 404],
    ['archived', 409],
  ] as const)('refuses a %s Driver and writes nothing', async (presence, statusCode) => {
    const fake = fakeUnavailabilityPorts({ presence })
    await expect(recordUnavailability(fake.ports, 'admin', record)).rejects.toMatchObject({ statusCode })
    expect(fake.calls).toEqual(['lock', 'presence:driver'])
    expect(fake.audits).toEqual([])
  })

  it('returns the occupying Rides whose occupied window it covers, and asks from one duration before', async () => {
    const fake = fakeUnavailabilityPorts({
      rides: [ride(rideId, at(9, 30)), ride(laterRideId, at(12)), ride('e3e3e3e3-4444-4444-8444-444444444444', at(9))],
    })
    const saved = await recordUnavailability(fake.ports, 'admin', record)
    // 09:00 + 60 minutes ends where the window starts, and 12:00 starts where it ends.
    expect(saved.coveredRides).toEqual([{ rideId, pickupAt: at(9, 30).toISOString() }])
    expect(fake.asked.ridesDuring).toEqual([{
      of: { driverIds: [driverId], vehicleIds: [], partnerIds: [] },
      from: at(9),
      to: at(12),
    }])
  })
})

describe('changeUnavailability', () => {
  const change = { windowId, startsAt: iso(11), endsAt: iso(12) }

  it('refuses a Driver role before it locks anything', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow] })
    await expect(changeUnavailability(fake.ports, 'driver', change)).rejects.toMatchObject({ statusCode: 403 })
    expect(fake.calls).toEqual([])
  })

  it('locks the window row, then the Tenant, then reads the Driver, and audits the moved field only', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow] })
    const saved = await changeUnavailability(fake.ports, 'dispatcher', change)
    expect(fake.calls).toEqual(['lockLive', 'lock', 'presence:driver', 'update', 'audit', 'minutes', 'ridesDuring'])
    expect(saved.window).toEqual({ id: windowId, driverId, vehicleId: null, startsAt: iso(11), endsAt: iso(12) })
    expect(fake.audits).toEqual([{ action: 'unavailability.changed', windowId, driverId, vehicleId: null, fields: ['startsAt'] }])
  })

  it('writes and audits nothing when the instants did not move', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow], rides: [ride(rideId, at(11))] })
    const saved = await changeUnavailability(fake.ports, 'admin', { windowId, startsAt: iso(10), endsAt: iso(12) })
    expect(fake.calls).not.toContain('update')
    expect(fake.audits).toEqual([])
    expect(saved.coveredRides).toEqual([{ rideId, pickupAt: iso(11) }])
  })

  it('refuses a missing or removed window before the Tenant lock', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow], removed: [windowId] })
    await expect(changeUnavailability(fake.ports, 'admin', change)).rejects.toMatchObject({ statusCode: 404 })
    expect(fake.calls).toEqual(['lockLive'])
  })

  it('refuses a window of an archived Driver and writes nothing', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow], presence: 'archived' })
    await expect(changeUnavailability(fake.ports, 'admin', change)).rejects.toMatchObject({ statusCode: 409 })
    expect(fake.calls).toEqual(['lockLive', 'lock', 'presence:driver'])
    expect(fake.audits).toEqual([])
  })
})

describe('removeUnavailability', () => {
  it('locks the row and the Tenant, marks it removed, and audits the removed mark', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow] })
    await removeUnavailability(fake.ports, 'admin', windowId)
    expect(fake.calls).toEqual(['lockLive', 'lock', 'markRemoved', 'audit'])
    expect(fake.audits).toEqual([{ action: 'unavailability.removed', windowId, driverId, vehicleId: null, fields: ['removed'] }])
  })

  it('removes a window of an archived Driver, so a mistake can still be undone', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow], presence: 'archived' })
    await removeUnavailability(fake.ports, 'dispatcher', windowId)
    expect(fake.calls).toContain('markRemoved')
  })

  it('refuses a Driver role, and a missing window, writing nothing', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow] })
    await expect(removeUnavailability(fake.ports, 'driver', windowId)).rejects.toMatchObject({ statusCode: 403 })
    await expect(removeUnavailability(fake.ports, 'admin', NEW_WINDOW_ID)).rejects.toMatchObject({ statusCode: 404 })
    expect(fake.calls).toEqual(['lockLive'])
    expect(fake.audits).toEqual([])
  })
})

describe('reads', () => {
  it('lists the live windows of one Driver as views', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow] })
    await expect(listUnavailabilityOf(fake.ports, 'dispatcher', { kind: 'driver', id: driverId })).resolves.toEqual([
      { id: windowId, driverId, vehicleId: null, startsAt: iso(10), endsAt: iso(12) },
    ])
    expect(fake.calls).not.toContain('lock')
  })

  it('answers 404 for a missing Vehicle and 403 for a Driver role', async () => {
    const fake = fakeUnavailabilityPorts({ presence: 'missing' })
    await expect(listUnavailabilityOf(fake.ports, 'admin', { kind: 'vehicle', id: vehicleId })).rejects.toMatchObject({ statusCode: 404 })
    await expect(listUnavailabilityOf(fake.ports, 'driver', { kind: 'vehicle', id: vehicleId })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists an archived Driver\'s windows, which still count nowhere but stay visible', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow], presence: 'archived' })
    await expect(listUnavailabilityOf(fake.ports, 'admin', { kind: 'driver', id: driverId })).resolves.toHaveLength(1)
  })

  it('lists the Tenant\'s live windows that touch a range, office only', async () => {
    const fake = fakeUnavailabilityPorts({ windows: [driverWindow] })
    await expect(listUnavailabilityDuring(fake.ports, 'admin', { from: at(11), to: at(13) })).resolves.toHaveLength(1)
    await expect(listUnavailabilityDuring(fake.ports, 'admin', { from: at(12), to: at(13) })).resolves.toEqual([])
    await expect(listUnavailabilityDuring(fake.ports, 'driver', { from: at(0), to: at(13) })).rejects.toMatchObject({ statusCode: 403 })
  })
})
