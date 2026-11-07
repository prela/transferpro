import type { Locator, Page } from '@playwright/test'
import { instantFromWallClock } from '../shared/date'
import { formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedMember, seedTenant } from './fixtures/seed'
import { openAudit, openRideMenu, openUserMenu, signIn, signOut, switchLocale, switchTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // One instant for the seed and the board, including across 05:00.
  await pinOperationalClock(page)
})

const landingWall = '2026-01-15T10:30'
const landingHr = '15. 01. 2026. 10:30'
const driverWall = '2026-01-15T11:00'
const driverHr = '15. 01. 2026. 11:00'
const driverEn = '15/01/2026, 11:00'
const guest = 'Ana Slijetanje'

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

test('the office and the Driver record a landing time in both languages and both themes', async ({ page }) => {
  const tenant = await seedTenant('record-landing')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Marko Slijetanje',
    kind: 'own',
    phone: '+385911110027',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
    memberUserId: driver.userId,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU027AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Slijetanje', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Zracna Slijetanje', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Slijetanje', kind: 'hotel' })
  const day = operationalDay(page)
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      price: 10,
      payment: 'cash',
      airportMark: true,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id

  await page.goto('/transfers')
  await openRideMenu(page, guest)
  await page.getByRole('menuitem', { name: 'Zabilježi slijetanje', exact: true }).click()
  await page.locator('#landing-time').fill(landingWall)
  await page.getByRole('button', { name: 'Spremi vrijeme slijetanja', exact: true }).click()
  await page.getByRole('button', { name: 'Proširi sve', exact: true }).click()
  await expect(page.getByText(landingHr)).toBeVisible()

  await openAudit(page)
  const landingRow = page.getByRole('row', { name: 'Zabilježeno vrijeme slijetanja' })
  await expect(landingRow.getByRole('cell', { name: tenant.adminName })).toBeVisible()

  await page.goto('/transfers')
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()

  // The row's Radnje menu is also aria-haspopup, so sign-out uses the Tenant button.
  await openUserMenu(page, tenant.name)
  await page.getByRole('menuitem', { name: 'Odjava', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await signIn(page, driver.email, driver.password, tenant.name)
  await page.getByRole('button', { name: 'Vrijeme slijetanja', exact: true }).click()
  await page.locator('#landing-time').fill(driverWall)
  await page.getByRole('button', { name: 'Spremi vrijeme slijetanja', exact: true }).click()
  await expect(page.getByText(driverHr)).toBeVisible()

  await signOut(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/transfers')
  await page.getByRole('button', { name: 'Proširi sve', exact: true }).click()
  await expect(page.getByText(driverHr)).toBeVisible()
  await switchTheme(page, 'dark')
  await page.getByRole('button', { name: 'Proširi sve', exact: true }).click()
  await expect(page.getByText(driverHr)).toBeVisible()
  await switchLocale(page, 'en')
  await page.getByRole('button', { name: 'Expand all', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Details: Ana Slijetanje' })).toBeVisible()
  await expect(page.getByText(driverEn)).toBeVisible()
  await switchTheme(page, 'light')
  await page.getByRole('button', { name: 'Expand all', exact: true }).click()
  await expect(page.getByText(driverEn)).toBeVisible()

  await openRideMenu(page, guest)
  await page.getByRole('menuitem', { name: 'Record landing', exact: true }).click()
  await page.getByRole('button', { name: 'Clear landing time', exact: true }).click()
  await expect(page.getByText(driverEn)).toHaveCount(0)
})

test('@phone a driver records a landing time from the next ride', async ({ page }) => {
  const tenant = await seedTenant('record-landing-phone')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Marko Slijetanje',
    kind: 'own',
    phone: '+385911110127',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
    memberUserId: driver.userId,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU127AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Slijetanje', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Zracna Slijetanje', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Slijetanje', kind: 'hotel' })
  const day = operationalDay(page)
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      price: 10,
      payment: 'cash',
      airportMark: true,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  await page.getByRole('button', { name: 'Vrijeme slijetanja', exact: true }).click()
  await page.locator('#landing-time').fill(driverWall)
  await page.getByRole('button', { name: 'Spremi vrijeme slijetanja', exact: true }).click()
  await expect(page.getByText(driverHr)).toBeVisible()

  await switchLocale(page, 'en')
  await expect(page.getByRole('button', { name: 'Landing time', exact: true })).toBeVisible()
  await expect(page.getByText(driverEn)).toBeVisible()
})

/**
 * A later Ride is one row until the Driver taps it. The next Ride has no
 * expand button, so this waits until the row is on the page first.
 */
async function showRide(page: Page, guest: string): Promise<Locator> {
  const article = page.locator('article').filter({ hasText: guest })
  await expect(article).toBeVisible()
  const heading = article.getByRole('heading', { name: guest, exact: true })
  if (await heading.count() === 0)
    await article.getByRole('button', { expanded: false }).click()
  await expect(heading).toBeVisible()
  return article
}

test('@phone a landing time opens on the tapped ride, in both languages and both themes', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  const tenant = await seedTenant('record-landing-sheet')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Marko Slijetanje',
    kind: 'own',
    phone: '+385911115470',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
    memberUserId: driver.userId,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU547AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Slijetanje', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Zracna Slijetanje', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Slijetanje', kind: 'hotel' })
  const day = operationalDay(page)
  const guests = Array.from({ length: 20 }, (_, index) => `Gost ${String(index + 1).padStart(2, '0')}`)
  const target = guests[19]!
  let targetPickup = ''
  for (const [index, guestName] of guests.entries()) {
    const minutes = 8 * 60 + index * 20
    const hour = String(Math.floor(minutes / 60)).padStart(2, '0')
    const minute = String(minutes % 60).padStart(2, '0')
    const pickupAt = instantFromWallClock(`${day}T${hour}:${minute}`, 'Europe/Zagreb').toISOString()
    if (guestName === target)
      targetPickup = formatInstant(new Date(pickupAt), 'Europe/Zagreb', 'hr')
    const recorded = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt,
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName,
        price: 10,
        payment: 'cash',
        airportMark: true,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    expect(recorded.ok()).toBeTruthy()
    const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
    const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { version: 0, driverId, vehicleId },
    })
    expect(assigned.ok()).toBeTruthy()
  }

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  const article = await showRide(page, target)
  const trigger = article.getByRole('button', { name: 'Vrijeme slijetanja', exact: true })
  await trigger.scrollIntoViewIfNeeded()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await trigger.click()

  const sheet = page.getByRole('dialog')
  const field = page.locator('#landing-time')
  await expect(field).toBeFocused()
  await expect(field).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
  await expect(sheet.getByRole('heading', { name: `Zabilježi slijetanje: ${target}` })).toBeVisible()
  await expect(sheet.getByText(`Vrijeme preuzimanja ${targetPickup}`)).toBeVisible()
  await expectNoAxeViolations(page)

  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await sheet.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await field.fill(driverWall)
  await sheet.getByRole('button', { name: 'Spremi vrijeme slijetanja', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(article.getByText(driverHr)).toBeVisible()
  await expect(page.getByText(driverHr)).toHaveCount(1)

  await switchTheme(page, 'dark')
  const darkArticle = await showRide(page, target)
  await darkArticle.getByRole('button', { name: 'Vrijeme slijetanja', exact: true }).click()
  await expect(page.locator('#landing-time')).toBeVisible()
  await expectNoAxeViolations(page)
  await page.keyboard.press('Escape')

  await switchLocale(page, 'en')
  const englishPickup = formatInstant(instantFromWallClock(`${day}T14:20`, 'Europe/Zagreb'), 'Europe/Zagreb', 'en')
  const englishArticle = await showRide(page, target)
  await englishArticle.getByRole('button', { name: 'Landing time', exact: true }).click()
  const englishSheet = page.getByRole('dialog')
  await expect(englishSheet.getByRole('heading', { name: `Record landing: ${target}` })).toBeVisible()
  await expect(englishSheet.getByText(`Pickup time ${englishPickup}`)).toBeVisible()
  await expect(englishArticle.getByText(driverEn)).toBeVisible()
  await expectNoAxeViolations(page)
})
