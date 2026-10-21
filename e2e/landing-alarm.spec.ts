import type { APIResponse } from '@playwright/test'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { operationalDateInTimeZone } from '../shared/date'
import { operationalDay, operationalNow, pinOperationalClock } from './fixtures/operational-clock'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, switchTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // One instant for the pickup offsets and the board, including across 05:00.
  await pinOperationalClock(page)
})

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function storeLanding(rideId: string, landingAt: string): Promise<void> {
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

test('an in-progress Ride with a landing shows the landing alarm on home and the day board, and a Ride without one does not', async ({ page }) => {
  const tenant = await seedTenant('landing-alarm')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Agencija Mora', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Zračna luka Dubrovnik', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Excelsior', kind: 'hotel' },
  }))
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Ana Slobodna',
      kind: 'own',
      phone: '+38595555183',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU183AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))

  // Pickup 90 minutes ago keeps the unclosed mark (pickup + 60). Landing 150
  // minutes ago keeps the landing alarm (landing + duration 60 + grace 60).
  // Near the operational-day start that pickup can fall on the previous day;
  // the board selects that day explicitly after every remount.
  const timeZone = 'Europe/Zagreb'
  const now = operationalNow(page)
  const pickup = new Date(now.getTime() - 90 * 60 * 1000)
  const landing = new Date(now.getTime() - 150 * 60 * 1000)
  async function record(guestName: string): Promise<string> {
    const response = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt: pickup.toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName,
        price: 10,
        payment: 'cash',
        airportMark: true,
        luggageCount: 0,
        childSeatCount: 0,
        note: null,
        tabla: '',
      },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
    const body = await response.json() as { ride: { id: string } }
    const assigned = await page.request.post(`/api/rides/${body.ride.id}/assign`, {
      data: { version: 0, driverId, vehicleId },
    })
    if (!assigned.ok())
      throw new Error(`${assigned.status()} ${await assigned.text()}`)
    return body.ride.id
  }

  const landedId = await record('Landed Lana')
  await storeLanding(landedId, landing.toISOString())
  await record('Open Lara')

  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  // A landing alarm and an unclosed mark are urgent, so both rows sit in Pozornost.
  const progress = page.getByRole('region', { name: 'Pozornost' })
  const landed = progress.getByRole('listitem').filter({ hasText: 'Landed Lana' })
  const open = progress.getByRole('listitem').filter({ hasText: 'Open Lara' })
  await expect(landed).toContainText('Alarm slijetanja')
  await expect(landed).toContainText('Nije zatvoreno')
  await expect(open).toContainText('Nije zatvoreno')
  await expect(open).not.toContainText('Alarm slijetanja')

  await switchLocale(page, 'en')
  const progressEn = page.getByRole('region', { name: 'Attention' })
  await expect(progressEn.getByRole('listitem').filter({ hasText: 'Landed Lana' })).toContainText('Landing alarm')
  await expect(progressEn.getByRole('listitem').filter({ hasText: 'Open Lara' })).not.toContainText('Landing alarm')
  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(progressEn.getByRole('listitem').filter({ hasText: 'Landed Lana' })).toContainText('Landing alarm')
  await switchTheme(page, 'light')

  await page.goto('/transfers')
  // A pickup 90 minutes before 05:00 is the previous operational day. Filling
  // that day writes it into the URL, and a locale or theme return keeps it.
  // Open the pinned day first, then select the pickup day again. The value
  // checks stay: the board is on the pinned day, then on the pickup day.
  const pickupDay = operationalDateInTimeZone(timeZone, pickup)
  async function showPickupDay(): Promise<void> {
    const today = operationalDay(page)
    const url = new URL(page.url())
    if (url.pathname !== '/transfers' || url.searchParams.get('day') !== today)
      await page.goto(`/transfers?day=${today}`)
    // The server paints the operational day before Vue starts. A fill in
    // that gap is overwritten (same rule as the other board specs).
    await hydrated(page)
    await expect(page.locator('#transfer-day')).toHaveValue(today)
    await page.locator('#transfer-day').fill(pickupDay)
    await expect(page.locator('#transfer-day')).toHaveValue(pickupDay)
  }
  await showPickupDay()
  const boardLanded = page.getByRole('row').filter({ hasText: 'Landed Lana' })
  const boardOpen = page.getByRole('row').filter({ hasText: 'Open Lara' })
  await expect(boardLanded).toContainText('Landing alarm')
  await boardLanded.getByRole('button', { name: 'Actions: Landed Lana' }).click()
  await expect(page.getByRole('menuitem', { name: 'Change vehicle', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(boardOpen).not.toContainText('Landing alarm')
  await boardOpen.getByRole('button', { name: 'Actions: Open Lara' }).click()
  await expect(page.getByRole('menuitem', { name: 'Change vehicle', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await switchLocale(page, 'hr')
  await showPickupDay()
  await expect(page.getByRole('row').filter({ hasText: 'Landed Lana' })).toContainText('Alarm slijetanja')
  await switchTheme(page, 'dark')
  await showPickupDay()
  await expect(page.getByRole('row').filter({ hasText: 'Landed Lana' })).toContainText('Alarm slijetanja')
})
