import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { openAudit, signIn, switchLocale } from './fixtures/ui'

const driverName = 'Ana Roster'
const otherDriverName = 'Marko Roster'
const plate = 'DU123AB'
const otherPlate = 'ZG111AA'
const phone = '+38591111222'
const farExpiry = '2099-01-01'

async function addDriver(page: Page, name: string) {
  const response = await page.request.post('/api/drivers', {
    data: {
      name,
      kind: 'own',
      phone,
      drivingLicenceExpiresOn: farExpiry,
      transportLicenceExpiresOn: farExpiry,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function addVehicle(page: Page, registrationPlate: string) {
  const response = await page.request.post('/api/vehicles', {
    data: {
      registrationPlate,
      kind: 'fixed',
      registrationExpiresOn: farExpiry,
      technicalInspectionExpiresOn: farExpiry,
      insuranceExpiresOn: farExpiry,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function chooseVehicle(page: Page, name: string, registrationPlate: string) {
  await page.getByRole('combobox', { name: `Vozilo za ${name}` }).click()
  await page.getByRole('option', { name: registrationPlate, exact: true }).click()
  await page.getByRole('button', { name: `Spremi vozilo za ${name}` }).click()
}

test('admin gives a driver a vehicle for the day, and the audit log keeps the plate and the name off the row', async ({ page }) => {
  const tenant = await seedTenant('roster-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await addDriver(page, driverName)
  await addDriver(page, otherDriverName)
  await addVehicle(page, plate)
  await addVehicle(page, otherPlate)

  await page.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: driverName })).toBeVisible()
  await expect(page.getByText(phone)).toHaveCount(0)

  await chooseVehicle(page, driverName, plate)
  await expect(page.getByRole('status')).toContainText('Spremljeno.')

  await page.reload()
  await expect(page.getByRole('combobox', { name: `Vozilo za ${driverName}` })).toContainText(plate)

  await chooseVehicle(page, otherDriverName, plate)
  await expect(page.getByRole('alert')).toContainText('To vozilo je već dano drugom vozaču za taj dan.')

  await chooseVehicle(page, driverName, otherPlate)
  await expect(page.getByRole('status')).toContainText('Spremljeno.')

  await chooseVehicle(page, otherDriverName, plate)
  await expect(page.getByRole('status')).toContainText('Spremljeno.')

  await page.getByRole('button', { name: `Ukloni vozilo za ${driverName}` }).click()
  await expect(page.getByRole('button', { name: `Ukloni vozilo za ${driverName}` })).toHaveCount(0)

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { level: 1, name: 'Vehicle roster' })).toBeVisible()
  await expect(page.getByLabel('Date')).toBeVisible()
  await expect(page.getByRole('button', { name: `Clear vehicle for ${otherDriverName}` })).toBeVisible()

  await switchLocale(page, 'hr')
  await openAudit(page)
  await expect(page.getByRole('cell', { name: 'Vozilo dodijeljeno za dan', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vozilo za dan promijenjeno', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vozilo za dan uklonjeno', exact: true })).toBeVisible()
  await expect(page.getByText(plate)).toHaveCount(0)
  await expect(page.getByText(otherPlate)).toHaveCount(0)
  await expect(page.getByText(driverName)).toHaveCount(0)
  await expect(page.getByText(otherDriverName)).toHaveCount(0)
  await expect(page.getByText(phone)).toHaveCount(0)
})

test('dispatcher gives a driver a vehicle for the day', async ({ page }) => {
  const tenant = await seedTenant('roster-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)

  await page.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()
  await chooseVehicle(page, driverName, plate)
  await expect(page.getByRole('status')).toContainText('Spremljeno.')
  await page.reload()
  await expect(page.getByRole('combobox', { name: `Vozilo za ${driverName}` })).toContainText(plate)
})
