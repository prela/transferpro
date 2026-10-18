import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { openAudit, openRideMenu, openUserMenu, signIn, signOut, switchLocale, switchTheme } from './fixtures/ui'

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
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Slijetanje', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Zracna Slijetanje', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Slijetanje', kind: 'hotel' })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await page.request.post('/api/transfers', {
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
  await expect(page.getByText(driverHr)).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(page.getByText(driverHr)).toBeVisible()
  await switchLocale(page, 'en')
  await expect(page.getByRole('columnheader', { name: 'Flight' })).toBeVisible()
  await expect(page.getByText(driverEn)).toBeVisible()
  await switchTheme(page, 'light')
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
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Slijetanje', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Zracna Slijetanje', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Slijetanje', kind: 'hotel' })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await page.request.post('/api/transfers', {
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
