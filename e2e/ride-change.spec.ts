import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, openAudit, openRideMenu, signIn, switchLocale, useTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // One instant for the seed and the board, including across 05:00.
  await pinOperationalClock(page)
})

const phone = '+385911112244'
const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function addDriver(page: Page, name: string): Promise<void> {
  await createdId(page, '/api/drivers', {
    name,
    kind: 'own',
    phone,
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
}

async function addVehicle(page: Page, registrationPlate: string): Promise<void> {
  await createdId(page, '/api/vehicles', {
    registrationPlate,
    kind: 'fixed',
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
}

async function recordTodayRide(page: Page, guest: string): Promise<void> {
  const clientId = await createdId(page, '/api/clients', { name: `Klijent ${guest}`, kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: `Polazak ${guest}`, kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: `Dolazak ${guest}`, kind: 'hotel' })
  const day = operationalDay(page)
  const pickupAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt,
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      price: 42.5,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
}

function row(page: Page, guest: string) {
  return page.getByRole('row', { name: guest })
}

test('an admin changes the vehicle, reassigns, and clears, and the audit log names the actor', async ({ page }) => {
  const tenant = await seedTenant('ride-change')
  const guest = 'Iva Change'
  const firstDriver = 'Ana Change'
  const secondDriver = 'Iva Druga'
  const firstPlate = 'DU310AA'
  const secondPlate = 'DU310BB'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await addDriver(page, firstDriver)
  await addDriver(page, secondDriver)
  await addVehicle(page, firstPlate)
  await addVehicle(page, secondPlate)
  await recordTodayRide(page, guest)

  await page.getByRole('link', { name: 'Transferi' }).click()
  await row(page, guest).getByRole('button', { name: `Dodijeli: ${guest}` }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), firstDriver)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), firstPlate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(row(page, guest).getByRole('cell', { name: /^Dodijeljeno/ })).toBeVisible()
  await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()

  await openRideMenu(page, guest)
  await page.getByRole('menuitem', { name: 'Promijeni vozilo', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Promjena vozila' })).toBeVisible()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), secondPlate)
  await page.getByRole('button', { name: 'Promijeni vozilo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Promjena vozila' })).toHaveCount(0)
  await expect(row(page, guest).getByRole('cell', { name: /^Dodijeljeno/ })).toBeVisible()
  await expect(row(page, guest)).toContainText(firstDriver)
  await expect(row(page, guest)).toContainText(secondPlate)
  await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()

  await openRideMenu(page, guest)
  await page.getByRole('menuitem', { name: 'Prebaci', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Prebacivanje vožnje' })).toBeVisible()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), secondDriver)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), firstPlate)
  await page.getByRole('button', { name: 'Prebaci vožnju', exact: true }).click()
  await expect(row(page, guest).getByRole('cell', { name: /^Dodijeljeno/ })).toBeVisible()
  await expect(row(page, guest)).toContainText(secondDriver)
  await expect(row(page, guest)).toContainText(firstPlate)
  await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()

  await openRideMenu(page, guest)
  await page.getByRole('menuitem', { name: 'Ukloni dodjelu', exact: true }).click()
  const clearDialog = page.getByRole('dialog', { name: 'Uklanjanje dodjele' })
  await expect(clearDialog).toBeVisible()
  await clearDialog.getByRole('button', { name: 'Ukloni dodjelu', exact: true }).click()
  await expect(row(page, guest).getByRole('cell', { name: /^Nedodijeljeno/ })).toBeVisible()
  await expect(row(page, guest).getByRole('button', { name: `Dodijeli: ${guest}` })).toBeVisible()

  await openAudit(page)
  for (const action of ['Vozilo promijenjeno', 'Vožnja prebačena', 'Dodjela uklonjena']) {
    const entry = page.getByRole('row', { name: action })
    await expect(entry).toContainText(tenant.adminName)
  }
  await expect(page.getByText(guest)).toHaveCount(0)
  await expect(page.getByText(phone)).toHaveCount(0)
})

test('the change, reassign, and clear controls use English copy in the dark theme', async ({ page }) => {
  const tenant = await seedTenant('ride-change-en')
  const guest = 'Iva English'
  const driverName = 'Ana English'
  const plate = 'DU320AA'
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, guest)

  await page.getByRole('link', { name: 'Transferi' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Transferi' })).toBeVisible()
  await switchLocale(page, 'en')
  await row(page, guest).getByRole('button', { name: `Assign: ${guest}` }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Driver' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vehicle' }), plate)
  await page.getByRole('button', { name: 'Assign ride', exact: true }).click()
  await expect(row(page, guest).getByRole('cell', { name: /^Assigned/ })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.locator('#ride-detail header').getByRole('button', { name: 'Close', exact: true }).click()

  await openRideMenu(page, guest)
  await expect(page.getByRole('menuitem', { name: 'Change vehicle', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Reassign', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Clear', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Change vehicle', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Change the vehicle' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
})
