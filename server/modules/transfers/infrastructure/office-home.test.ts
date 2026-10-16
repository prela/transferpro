import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
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
function catalogWithoutOneDriver(): { transaction: TenantTransaction, sql: string[] } {
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
          }],
        }
      }
      if (text.includes('app.vehicles'))
        return { rows: [] }
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
  expect(sql.join('\n')).not.toContain('audit_entry')
  expect(sql.join('\n')).not.toContain(removedName)
})
