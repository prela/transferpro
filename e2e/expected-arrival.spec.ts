import pg from 'pg'
import { instantFromWallClock } from '../shared/date'
import { operationalDay, pinOperationalClock, previousOperationalNoon } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedMember, seedTenant } from './fixtures/seed'
import { openUserMenu, signIn, switchLocale, switchTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // Noon on the current operational day is still ahead at 05:00, so it is
  // not in Pozornost. Yesterday's noon is already past at 04:55, 05:00,
  // and 05:05, and the board opens on that same day.
  await pinOperationalClock(page, previousOperationalNoon())
})

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

async function createdId(response: { ok: () => boolean, status: () => number, text: () => Promise<string>, json: () => Promise<unknown> }): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

/**
 * The screen does not type an expected arrival. The row is stored, then shown.
 * January is UTC+1 in Zagreb, so 11:00Z is 12:00.
 */
const expectedArrival = '2026-01-15T11:00:00.000Z'
const arrivalHr = '15. 01. 2026. 12:00'
const arrivalEn = '15/01/2026, 12:00'

async function storeExpectedArrival(rideId: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    await pool.query(
      `update app.transfers set expected_arrival_at = $1
       where id = (select transfer_id from app.rides where id = $2)`,
      [expectedArrival, rideId],
    )
  }
  finally {
    await pool.end()
  }
}

test('the office Ride and the Driver Ride show an expected arrival in both languages and both themes', async ({ page }) => {
  const tenant = await seedTenant('expected-arrival')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Dolazak',
      kind: 'own',
      phone: '+385911110175',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU175AA',
      kind: 'fixed',
      seatCount: 4,
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Dolazak', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Zracna luka', kind: 'airport', iata: 'DBV' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Dolazak', kind: 'hotel' },
  }))
  const day = operationalDay(page)
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: 'Ana Dolazak',
      flightNumber: 'OU 384',
      price: 10,
      payment: 'cash',
      airportMark: true,
      luggageCount: 0,
      childSeatCount: 0,
      note: null,
      tabla: '',
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const body = await recorded.json() as { ride: { id: string } }
  await storeExpectedArrival(body.ride.id)

  await page.goto('/')
  // The arrival sits in the Ride detail. Home keeps the urgent row only.
  const homeRow = page.getByRole('region', { name: 'Pozornost' }).getByRole('listitem').filter({ hasText: 'Ana Dolazak' })
  await homeRow.getByRole('button').click()
  const detail = page.locator('#ride-detail')
  await expect(detail.getByText('Očekivani dolazak', { exact: true })).toBeVisible()
  await expect(detail.getByText(arrivalHr, { exact: true })).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(detail.getByText(arrivalHr, { exact: true })).toBeVisible()
  await switchLocale(page, 'en')
  await expect(detail.getByText('Expected arrival', { exact: true })).toBeVisible()
  await expect(detail.getByText(arrivalEn, { exact: true })).toBeVisible()
  await switchTheme(page, 'light')
  await expect(detail.getByText(arrivalEn, { exact: true })).toBeVisible()

  await page.goto('/transfers')
  await expect(page.getByRole('columnheader', { name: 'Flight' })).toBeVisible()
  await expect(page.getByText(arrivalEn)).toBeVisible()
  await switchLocale(page, 'hr')
  await expect(page.getByRole('columnheader', { name: 'Let' })).toBeVisible()
  await expect(page.getByText(arrivalHr)).toBeVisible()

  const assigned = await page.request.post(`/api/rides/${body.ride.id}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  if (!assigned.ok())
    throw new Error(`${assigned.status()} ${await assigned.text()}`)

  // The row's Radnje menu is also aria-haspopup, so sign-out uses the Tenant button.
  await openUserMenu(page, tenant.name)
  await page.getByRole('menuitem', { name: 'Odjava', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await signIn(page, driver.email, driver.password, tenant.name)
  await expect(page.getByText('Očekivani dolazak')).toBeVisible()
  await expect(page.getByText(arrivalHr)).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(page.getByText(arrivalHr)).toBeVisible()
  await switchLocale(page, 'en')
  await expect(page.getByText('Expected arrival')).toBeVisible()
  await expect(page.getByText(arrivalEn)).toBeVisible()
})
