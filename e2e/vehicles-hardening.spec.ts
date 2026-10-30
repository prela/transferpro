import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/playwright'
import { seedTenant } from './fixtures/seed'
import { chooseOption, signIn, switchLocale } from './fixtures/ui'

const archivedPlate = 'ARC81AA'
const livePlate = 'LIV81BB'

async function addVehicle(page: Page, plate: string, kind: 'Stalno' | 'Povremeno') {
  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Registarska oznaka', { exact: true }).fill(plate)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), kind)
  await dialog.getByLabel('Registracija vrijedi do').fill('2027-06-01')
  await dialog.getByLabel('Tehnički pregled vrijedi do').fill('2028-01-31')
  await dialog.getByLabel('Osiguranje vrijedi do').fill('2029-03-03')
  await dialog.getByLabel('Broj sjedala').fill('8')
  await dialog.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${plate}` })).toBeVisible()
}

test('correcting a plate to an archived plate shows the archived-conflict message, not the live-duplicate message', async ({ page }) => {
  const tenant = await seedTenant('vehicles-archived-conflict')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Vozila' }).click()
  await expect(page.getByRole('button', { name: tenant.name, exact: true })).toBeVisible()

  await addVehicle(page, archivedPlate, 'Stalno')
  await page.getByRole('button', { name: `Radnje: ${archivedPlate}` }).click()
  await page.getByRole('menuitem', { name: 'Arhiviraj', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Arhiviraj', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Još nema vozila. Dodajte prvo.')).toBeVisible()

  await addVehicle(page, livePlate, 'Povremeno')
  await page.getByRole('button', { name: livePlate, exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Registarska oznaka', { exact: true }).fill(archivedPlate)
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(1)
  await expect(dialog.getByRole('alert')).toContainText(
    'Vozilo s tom registarskom oznakom je arhivirano. Uključite arhivirana vozila ili vratite arhivirano vozilo prije dodavanja ili ispravka.',
  )
  await expect(dialog.getByRole('alert')).not.toContainText('Vozilo s tom registarskom oznakom već postoji.')
  await expect(dialog.getByRole('alert')).not.toContainText(archivedPlate)

  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  await switchLocale(page, 'en')
  await page.getByRole('button', { name: livePlate, exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Registration plate', { exact: true }).fill(archivedPlate)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    'A vehicle with this registration plate is archived. Show archived vehicles or restore the archived vehicle before adding or correcting.',
  )
  await expect(dialog.getByRole('alert')).not.toContainText('A vehicle with this registration plate already exists.')
})
