import { expect, test } from '@playwright/test'
import pg from 'pg'
import { calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { formatInstant } from '../shared/format-instant'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, signOut, useTheme } from './fixtures/ui'

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

/** The owner role. The app has no command for done yet, so the spec sets it. */
async function markDone(rideId: string) {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    await pool.query(`update app.rides set state = 'done' where id = $1`, [rideId])
  }
  finally {
    await pool.end()
  }
}

test('a driver sees only their own rides, cash shows the fare, and the app is installable', async ({ page }) => {
  const tenant = await seedTenant('driver-rides')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const cardAt = instantFromWallClock(`${day}T09:00`, 'Europe/Zagreb')
  const cashAt = instantFromWallClock(`${day}T15:30`, 'Europe/Zagreb')

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect(page.getByRole('link', { name: 'Transferi' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Moje vožnje' })).toHaveCount(0)

  const licence = '2031-01-01'
  const ownDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Vlastiti',
      kind: 'own',
      phone: '+385911110301',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const otherDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Iva Druga',
      kind: 'own',
      phone: '+385911110302',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU300AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Vozač', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Park', kind: 'hotel' },
  }))

  async function record(guest: string, pickupAt: Date, payment: 'cash' | 'card', price: number, extra?: { flightNumber?: string, airportMark?: boolean, passengerCount?: number }) {
    const recorded = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt: pickupAt.toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: extra?.passengerCount ?? 1,
        guestName: guest,
        flightNumber: extra?.flightNumber ?? null,
        price,
        payment,
        airportMark: extra?.airportMark ?? false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    const body = await recorded.json() as { ride: { id: string } }
    return body.ride.id
  }

  async function assign(rideId: string, assignee: string) {
    const response = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { driverId: assignee, vehicleId },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
  }

  const cardRide = await record('Nika Plastika', cardAt, 'card', 99)
  await assign(cardRide, ownDriverId)
  const cashRide = await record('Nika Sunce', cashAt, 'cash', 42.5, {
    flightNumber: 'OU 384',
    airportMark: true,
    passengerCount: 3,
  })
  await assign(cashRide, ownDriverId)
  const otherRide = await record('Nika Druga', cashAt, 'cash', 15)
  await assign(otherRide, otherDriverId)
  const doneRide = await record('Nika Kraj', cashAt, 'cash', 11)
  await assign(doneRide, ownDriverId)
  await markDone(doneRide)

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('heading', { name: 'Moje vožnje' })).toBeVisible()
  const cashCard = page.locator('article').filter({ hasText: 'Nika Sunce' })
  const cardCard = page.locator('article').filter({ hasText: 'Nika Plastika' })
  await expect(cashCard.getByRole('heading', { name: 'Nika Sunce' })).toBeVisible()
  await expect(cardCard.getByRole('heading', { name: 'Nika Plastika' })).toBeVisible()
  await expect(page.getByText('Nika Druga')).toHaveCount(0)
  await expect(page.getByText('Nika Kraj')).toHaveCount(0)
  await expect(cashCard.getByText(formatInstant(cashAt, 'Europe/Zagreb', 'hr'))).toBeVisible()
  await expect(cashCard.getByText('Polazak')).toBeVisible()
  await expect(cashCard.getByText('Hotel Park')).toBeVisible()
  await expect(cashCard.getByText('3', { exact: true })).toBeVisible()
  await expect(cashCard.getByText('OU 384')).toBeVisible()
  await expect(cashCard.getByText('Zračna luka')).toBeVisible()
  await expect(cardCard.getByText('Zračna luka')).toHaveCount(0)
  await expect(cashCard.getByText('42,50 EUR')).toBeVisible()
  await expect(cashCard.getByText('Gotovina')).toBeVisible()
  await expect(cardCard.getByText('99,00 EUR')).toHaveCount(0)
  await expect(cardCard.getByText('99.00')).toHaveCount(0)
  await expect(cardCard.getByText('Gotovina')).toHaveCount(0)
  await expect(cardCard.getByText('Kartica')).toHaveCount(0)
  await expect(cardCard.getByText('Card')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible()
  await expect(cashCard.getByText('Cash')).toBeVisible()
  await expect(cashCard.getByText('42.50 EUR')).toBeVisible()
  await expect(cashCard.getByText('Airport')).toBeVisible()
  await expect(cardCard.getByText('99.00')).toHaveCount(0)
  await expect(cardCard.getByText('Card')).toHaveCount(0)

  await page.getByRole('button', { name: 'Dark theme' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(cashCard.getByRole('heading', { name: 'Nika Sunce' })).toBeVisible()
  await expect(cardCard.getByText('99.00')).toHaveCount(0)

  const manifestLink = page.locator('link[rel="manifest"]')
  await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest')
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBeTruthy()
  expect(manifest.headers()['content-type']).toContain('application/manifest+json')
  const body = await manifest.json() as { name: string, display: string, icons: Array<{ sizes: string }> }
  expect(body.name).toBe('Transferpro')
  expect(body.display).toBe('standalone')
  expect(body.icons.map(icon => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect((await page.request.get('/icons/icon-192.png')).ok()).toBeTruthy()
  expect((await page.request.get('/icons/icon-512.png')).ok()).toBeTruthy()
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return registration !== undefined
  })
})

test('a driver with no linked Driver sees an empty list', async ({ page }) => {
  const tenant = await seedTenant('driver-rides-empty')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Prazan')
  await useTheme(page, 'dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, driver.email, driver.password, tenant.name)
  await expect(page.getByRole('heading', { name: 'Moje vožnje' })).toBeVisible()
  await expect(page.getByText('Nemate nadolazećih vožnji.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Transferi' })).toHaveCount(0)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByText('You have no upcoming rides.')).toBeVisible()
})
