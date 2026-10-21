import { expect, test } from '@playwright/test'
import pg from 'pg'
import { instantFromWallClock } from '../shared/date'
import { operationalDay, pinOperationalClock, previousOperationalNoon } from './fixtures/operational-clock'
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
 * The screen does not type a landing time. The row is stored, then shown.
 * January is UTC+1 in Zagreb, so 09:30Z is 10:30.
 */
const landingAt = '2026-01-15T09:30:00.000Z'
const landingHr = '15. 01. 2026. 10:30'
const landingEn = '15/01/2026, 10:30'

async function storeLanding(rideId: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    await pool.query(
      `update app.transfers set landing_at = $1
       where id = (select transfer_id from app.rides where id = $2)`,
      [landingAt, rideId],
    )
  }
  finally {
    await pool.end()
  }
}

test('the office Ride and the Driver Ride show a stored landing time in both languages and both themes', async ({ page }) => {
  const tenant = await seedTenant('landing-time')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Slijetanje',
      kind: 'own',
      phone: '+385911110174',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU174AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Let', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Zracna luka', kind: 'airport', iata: 'DBV' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Let', kind: 'hotel' },
  }))
  const day = operationalDay(page)
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: 'Ana Let',
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
  await storeLanding(body.ride.id)

  await page.goto('/')
  // The landing time sits in the Ride detail. Home keeps the urgent row only.
  const homeRow = page.getByRole('region', { name: 'Pozornost' }).getByRole('listitem').filter({ hasText: 'Ana Let' })
  await homeRow.getByRole('button').click()
  const detail = page.locator('#ride-detail')
  await expect(detail.getByText('Vrijeme slijetanja', { exact: true })).toBeVisible()
  await expect(detail.getByText(landingHr, { exact: true })).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(detail.getByText(landingHr, { exact: true })).toBeVisible()
  await switchLocale(page, 'en')
  await expect(detail.getByText('Landing time', { exact: true })).toBeVisible()
  await expect(detail.getByText(landingEn, { exact: true })).toBeVisible()
  await switchTheme(page, 'light')
  await expect(detail.getByText(landingEn, { exact: true })).toBeVisible()

  await page.goto('/transfers')
  await expect(page.getByRole('columnheader', { name: 'Flight' })).toBeVisible()
  await expect(page.getByText(landingEn)).toBeVisible()
  await switchLocale(page, 'hr')
  await expect(page.getByRole('columnheader', { name: 'Let' })).toBeVisible()
  await expect(page.getByText(landingHr)).toBeVisible()

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
  await expect(page.getByText('Vrijeme slijetanja')).toBeVisible()
  await expect(page.getByText(landingHr)).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(page.getByText(landingHr)).toBeVisible()
  await switchLocale(page, 'en')
  await expect(page.getByText('Landing time')).toBeVisible()
  await expect(page.getByText(landingEn)).toBeVisible()
})
