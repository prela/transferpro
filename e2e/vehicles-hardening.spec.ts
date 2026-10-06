import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, signIn, useTheme } from './fixtures/ui'

const archivedPlate = 'ARC81AA'
const livePlate = 'LIV81BB'

async function addVehicle(page: Page, plate: string, kind: 'Stalno' | 'Povremeno') {
  await page.getByLabel('Registarska oznaka', { exact: true }).fill(plate)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), kind)
  await page.getByLabel('Registracija vrijedi do').fill('2027-06-01')
  await page.getByLabel('Tehnički pregled vrijedi do').fill('2028-01-31')
  await page.getByLabel('Osiguranje vrijedi do').fill('2029-03-03')
  await page.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(page.getByRole('button', { name: `Ispravi vozilo: ${plate}` })).toBeVisible()
}

test('correcting a plate to an archived plate shows the archived-conflict message, not the live-duplicate message', async ({ page }) => {
  const tenant = await seedTenant('vehicles-archived-conflict')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Vozila' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  await addVehicle(page, archivedPlate, 'Stalno')
  await page.getByRole('button', { name: `Arhiviraj: ${archivedPlate}` }).click()
  await expect(page.getByText('Još nema vozila.')).toBeVisible()

  await addVehicle(page, livePlate, 'Povremeno')
  await page.getByRole('button', { name: `Ispravi vozilo: ${livePlate}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Registarska oznaka', { exact: true }).fill(archivedPlate)
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(1)
  await expect(dialog.getByRole('alert')).toContainText(
    'Vozilo s tom registarskom oznakom je arhivirano. Uključite arhivirana vozila ili vratite arhivirano vozilo prije dodavanja ili ispravka.',
  )
  await expect(dialog.getByRole('alert')).not.toContainText('Vozilo s tom registarskom oznakom već postoji.')
  await expect(dialog.getByRole('alert')).not.toContainText(archivedPlate)

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    'A vehicle with this registration plate is archived. Show archived vehicles or restore the archived vehicle before adding or correcting.',
  )
  await expect(dialog.getByRole('alert')).not.toContainText('A vehicle with this registration plate already exists.')
})

for (const theme of ['light', 'dark'] as const) {
  test(`vehicles page is usable in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`vehicles-harden-theme-${theme}`)
    await useTheme(page, theme)
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.getByRole('link', { name: 'Vozila' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Vozila' })).toBeVisible()
    await expect(page.getByLabel('Registarska oznaka', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dodaj vozilo', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Vehicles' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add vehicle', exact: true })).toBeVisible()
  })
}

test('a driver cannot open vehicles', async ({ page }) => {
  const tenant = await seedTenant('vehicles-harden-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozač')
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('link', { name: 'Vozila' })).toHaveCount(0)
  await page.goto('/vehicles')
  await expect(page.getByRole('alert')).toContainText('Vozač ne može dodavati ni ispravljati vozila.')
  await expect(page.getByLabel('Registarska oznaka', { exact: true })).toHaveCount(0)
})
