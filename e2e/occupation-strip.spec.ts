import type { Page } from '@playwright/test'
import { addCalendarDays, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Occupation strip (issue #261). No earlier spec asserted that the strip
 * was absent, so none is rewritten. This spec is the new behaviour.
 */

const licence = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function recordRide(page: Page, guest: string, day: string, wall: string, spot: {
  clientId: string
  startLocationId: string
  endLocationId: string
}): Promise<string> {
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId: spot.clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
      startLocationId: spot.startLocationId,
      endLocationId: spot.endLocationId,
      passengerCount: 2,
      guestName: guest,
      price: 42.5,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const body = await recorded.json() as { ride: { id: string } }
  return body.ride.id
}

test('a block names the ride, opens its detail, and the collapsed strip survives reload', async ({ page }) => {
  const tenant = await seedTenant('strip-hr')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Ana Traka',
    kind: 'own',
    phone: '+385911110261',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU261AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  // A free Driver and a free Vehicle keep the confirmed overlap an overlap.
  await createdId(page, '/api/drivers', {
    name: 'Leo Slobodni',
    kind: 'own',
    phone: '+385911110262',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU261BB',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Traka', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Traka', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Traka', kind: 'hotel' })
  const spot = { clientId, startLocationId, endLocationId }
  const day = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 1)
  const first = await recordRide(page, 'Iva Traka', day, '12:00', spot)
  const second = await recordRide(page, 'Nika Traka', day, '12:30', spot)
  expect((await page.request.post(`/api/rides/${first}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })).ok()).toBeTruthy()
  expect((await page.request.post(`/api/rides/${second}/assign`, {
    data: { version: 0, driverId, vehicleId, confirm: true },
  })).ok()).toBeTruthy()
  expect((await page.request.put('/api/roster', {
    data: { rosterDate: day, driverId, vehicleId },
  })).ok()).toBeTruthy()

  const roster = page.waitForResponse(response =>
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/roster'
    && response.ok(),
  )
  await page.goto(`/transfers?day=${day}`)
  await roster
  await hydrated(page)

  const blockName = '12:00, 2 putnika, Polazak Traka → Dolazak Traka, Preklapanje'
  const block = page.getByRole('button', { name: blockName, exact: true })
  await expect(block).toBeVisible()
  await expect(page.getByRole('button', { name: '12:30, 2 putnika, Polazak Traka → Dolazak Traka, Preklapanje', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Zauzetost' })).toContainText('DU261AA, Ana Traka')
  // The two windows overlap, so the later block covers the centre of this one.
  await block.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#ride-detail')).toContainText('Iva Traka')
  await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()
  await expect(page.locator('#ride-detail')).toHaveCount(0)

  await page.getByRole('button', { name: 'Sakrij zauzetost', exact: true }).click()
  await expect(block).toHaveCount(0)
  await page.reload()
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'Prikaži zauzetost', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: blockName, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Prikaži zauzetost', exact: true }).click()
  await expect(page.getByRole('button', { name: blockName, exact: true })).toBeVisible()

  await useTheme(page, 'dark')
  await switchLocale(page, 'en')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('region', { name: 'Occupation' })).toBeVisible()
  await expect(page.getByRole('button', {
    name: '12:00, 2 passengers, Polazak Traka → Dolazak Traka, Overlap',
    exact: true,
  })).toBeVisible()
})

test.describe('@phone', () => {
  test('the occupation strip is absent on a phone', async ({ page }) => {
    const tenant = await seedTenant('strip-phone')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const driverId = await createdId(page, '/api/drivers', {
      name: 'Mia Traka',
      kind: 'own',
      phone: '+385911110262',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    })
    const vehicleId = await createdId(page, '/api/vehicles', {
      registrationPlate: 'DU261BB',
      kind: 'fixed',
      seatCount: 4,
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    })
    const clientId = await createdId(page, '/api/clients', { name: 'Klijent Telefon', kind: 'agency' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Telefon', kind: 'address' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Telefon', kind: 'address' })
    const day = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 1)
    const rideId = await recordRide(page, 'Tea Telefon', day, '15:00', { clientId, startLocationId, endLocationId })
    expect((await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { version: 0, driverId, vehicleId },
    })).ok()).toBeTruthy()

    await page.setViewportSize({ width: 390, height: 844 })
    const roster = page.waitForResponse(response =>
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/roster'
      && response.ok(),
    )
    await page.goto(`/transfers?day=${day}`)
    await roster
    await expect(page.getByText('Tea Telefon')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Zauzetost' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Sakrij zauzetost' })).toHaveCount(0)
  })
})
