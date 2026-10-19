import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { officeHomeUrgentRideCount } from '../../../../shared'
import { loadOfficeHome } from './office-home'

const dialect = new PgDialect()
const rideId = '11111111-1111-4111-8111-111111111111'
const missingDriverId = '22222222-2222-4222-8222-222222222222'
const presentDriverId = '33333333-3333-4333-8333-333333333333'
const clientId = '44444444-4444-4444-8444-444444444444'
const startId = '55555555-5555-4555-8555-555555555555'
const endId = '66666666-6666-4666-8666-666666666666'
const removedName = 'Lara Otišla'

/**
 * The catalog read returns every Driver that still has a row.
 * This script leaves one declining id out of that list, which is the
 * failure `requiredName` used to turn into a failed snapshot.
 */
const currentEntryId = '77777777-7777-4777-8777-777777777777'
const laterEntryId = '88888888-8888-4888-8888-888888888888'
const cancelledNoticeId = '99999999-9999-4999-8999-999999999999'
const hiddenDoneId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const hiddenSupersededId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const hiddenCancelledAssignId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const hiddenReplacedLostId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function catalogWithoutOneDriver(failedRows: ReadonlyArray<Record<string, unknown>> = []): { transaction: TenantTransaction, sql: string[] } {
  const sqlText: string[] = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql
      sqlText.push(text)
      if (text.includes('app.tenant_settings')) {
        return {
          rows: [{
            airport_wait_minutes: 90,
            elsewhere_wait_minutes: 25,
            time_zone: 'Europe/Zagreb',
            operational_day_start_hour: 5,
            transfer_duration_minutes: 60,
            relocation_gap_minutes: 15,
          }],
        }
      }
      if (text.includes('app.clients')) {
        return { rows: [{ id: clientId, name: 'Agencija Mora', kind: 'agency' }] }
      }
      if (text.includes('app.locations')) {
        return {
          rows: [
            { id: startId, name: 'Zračna luka', kind: 'airport', address: null, iata: null, placeProvider: null, placeRef: null, archivedAt: null },
            { id: endId, name: 'Hotel', kind: 'hotel', address: null, iata: null, placeProvider: null, placeRef: null, archivedAt: null },
          ],
        }
      }
      if (text.includes('app.drivers')) {
        return {
          rows: [{
            id: presentDriverId,
            name: 'Ana Vozač',
            kind: 'own',
            phone: '+385911110001',
            email: null,
            drivingLicenceExpiresOn: '2030-01-01',
            transportLicenceExpiresOn: '2030-06-01',
            memberUserId: null,
            mustAccept: false,
            archivedAt: null,
          }],
        }
      }
      if (text.includes('app.vehicles'))
        return { rows: [] }
      if (text.includes('app.mail_outbox'))
        return { rows: failedRows }
      if (text.includes('app.rides')) {
        return {
          rows: [{
            rideId,
            pickupAt: '2026-10-16T12:00:00.000Z',
            guestName: 'Gost Klara',
            passengerCount: 1,
            clientId,
            startLocationId: startId,
            endLocationId: endId,
            state: 'unassigned',
            driverId: null,
            vehicleId: null,
            mustAccept: null,
            price: '10.00',
            payment: 'cash',
            flightNumber: null,
            landingAt: null,
            expectedArrival: null,
            tabla: '',
            declinedBy: [missingDriverId, presentDriverId],
          }],
        }
      }
      throw new Error(`unexpected query: ${text}`)
    }),
  }
  return { transaction, sql: sqlText }
}

it('returns the office home snapshot when a declining Driver is absent from the catalog', async () => {
  const { transaction, sql } = catalogWithoutOneDriver()
  const snapshot = await loadOfficeHome(transaction, new Date('2026-10-16T10:00:00.000Z'))
  expect(snapshot.unassigned.map(row => ({
    rideId: row.rideId,
    declineAlerts: row.declineAlerts,
  }))).toEqual([
    {
      rideId,
      declineAlerts: [{ driverName: '—' }, { driverName: 'Ana Vozač' }],
    },
  ])
  const body = JSON.stringify(snapshot)
  expect(body).not.toContain(removedName)
  expect(body).not.toContain(missingDriverId)
  expect(snapshot.failedMails).toEqual([])
  expect(sql.join('\n')).not.toContain('audit_entry')
  expect(sql.join('\n')).not.toContain(removedName)
  const mailSql = sql.find(text => text.includes('app.mail_outbox')) ?? ''
  expect(mailSql).toContain(`'failed'`)
  expect(mailSql).not.toContain('email')
})

it('lists only failed work orders that still matter, with the Driver name and no address', async () => {
  const address = 'ana@example.test'
  const { transaction } = catalogWithoutOneDriver([
    mailRow(laterEntryId, 'assigned', 'accepted', false, '2026-10-16T15:00:00.000Z'),
    mailRow(currentEntryId, 'no_longer_yours', 'cancelled', false, '2026-10-16T09:00:00.000Z'),
    mailRow(cancelledNoticeId, 'cancelled', 'cancelled', false, '2026-10-16T11:00:00.000Z'),
    mailRow(hiddenDoneId, 'assigned', 'done', false, '2026-10-16T08:00:00.000Z'),
    mailRow(hiddenSupersededId, 'changed', 'accepted', true, '2026-10-16T08:30:00.000Z'),
    mailRow(hiddenCancelledAssignId, 'assigned', 'cancelled', false, '2026-10-16T08:45:00.000Z'),
    mailRow(hiddenReplacedLostId, 'no_longer_yours', 'no-show', false, '2026-10-16T08:50:00.000Z'),
  ])
  const snapshot = await loadOfficeHome(transaction, new Date('2026-10-16T10:00:00.000Z'))
  expect(snapshot.failedMails.map(row => [row.entryId, row.status, row.driverName])).toEqual([
    [currentEntryId, 'no_longer_yours', 'Ana Vozač'],
    [cancelledNoticeId, 'cancelled', 'Ana Vozač'],
    [laterEntryId, 'assigned', 'Ana Vozač'],
  ])
  expect(snapshot.failedMails[0]).toMatchObject({ start: 'Zračna luka', end: 'Hotel' })
  expect(JSON.stringify(snapshot)).not.toContain(address)
  expect(officeHomeUrgentRideCount(snapshot)).toBe(officeHomeUrgentRideCount({ ...snapshot, failedMails: [] }))
})

function mailRow(
  entryId: string,
  status: string,
  rideState: string,
  superseded: boolean,
  pickupAt: string,
): Record<string, unknown> {
  return {
    entryId,
    driverId: presentDriverId,
    status,
    rideState,
    superseded,
    pickupAt,
    startLocationId: startId,
    endLocationId: endId,
  }
}
