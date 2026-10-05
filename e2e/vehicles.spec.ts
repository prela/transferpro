import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

const plate = 'DU123AB'
const nextPlate = 'ZG111AA'

test('admin adds a vehicle, corrects it, archives it, and the audit log does not show the plate', async ({ page }) => {
  const tenant = await seedTenant('vehicles-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Vozila' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  // Other required fields are filled so the empty plate is the only alert.
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Stalno', exact: true }).click()
  await page.getByLabel('Registracija vrijedi do').fill('2027-06-01')
  await page.getByLabel('Tehnički pregled vrijedi do').fill('2028-01-31')
  await page.getByLabel('Osiguranje vrijedi do').fill('2029-03-03')
  await page.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText('Unesite registarsku oznaku.')

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Add vehicle', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText('Enter a registration plate.')

  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  await page.getByLabel('Registarska oznaka', { exact: true }).fill('du 123 ab')
  await page.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi vozilo: DU123AB' })).toBeVisible()
  await expect(page.getByRole('cell', { name: plate, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Stalno' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '1.6.2027.' })).toBeVisible()

  await page.getByRole('button', { name: 'Ispravi vozilo: DU123AB' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Registarska oznaka', { exact: true }).fill(nextPlate)
  await dialog.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Povremeno', exact: true }).click()
  await dialog.getByLabel('Osiguranje vrijedi do').fill('2030-04-04')
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Ispravi vozilo: ZG111AA' })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextPlate, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Povremeno' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '4.4.2030.' })).toBeVisible()

  await page.getByRole('button', { name: 'Arhiviraj: ZG111AA' }).click()
  await expect(page.getByRole('button', { name: 'Ispravi vozilo: ZG111AA' })).toHaveCount(0)
  await expect(page.getByText('Još nema vozila.')).toBeVisible()

  await page.getByLabel('Prikaži arhivirana').check()
  await expect(page.getByRole('button', { name: 'Ispravi vozilo: ZG111AA' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Arhivirano' })).toBeVisible()

  await page.getByRole('link', { name: 'Početna' }).click()
  await expect(page.getByRole('cell', { name: 'Vozilo dodano', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vozilo ispravljeno', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vozilo arhivirano', exact: true })).toBeVisible()
  await expect(page.getByText(plate)).toHaveCount(0)
  await expect(page.getByText(nextPlate)).toHaveCount(0)
  await expect(page.getByText('2027-06-01')).toHaveCount(0)
  await expect(page.getByText('2030-04-04')).toHaveCount(0)

  await page.getByRole('link', { name: 'Vozila' }).click()
  await expect(page).toHaveURL(/\/vehicles$/)
  await page.reload()
  await expect(page.getByText('Još nema vozila.')).toBeVisible()
})

test('dispatcher adds a vehicle and lists it', async ({ page }) => {
  const tenant = await seedTenant('vehicles-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Vozila' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  await page.getByLabel('Registarska oznaka', { exact: true }).fill('ST222CC')
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Povremeno', exact: true }).click()
  await page.getByLabel('Registracija vrijedi do').fill('2030-04-04')
  await page.getByLabel('Tehnički pregled vrijedi do').fill('2030-05-05')
  await page.getByLabel('Osiguranje vrijedi do').fill('2030-06-06')
  await page.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi vozilo: ST222CC' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Povremeno' })).toBeVisible()

  await page.getByLabel('Registarska oznaka', { exact: true }).fill('st 222 cc')
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Stalno', exact: true }).click()
  await page.getByLabel('Registracija vrijedi do').fill('2031-01-01')
  await page.getByLabel('Tehnički pregled vrijedi do').fill('2031-02-02')
  await page.getByLabel('Osiguranje vrijedi do').fill('2031-03-03')
  await page.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText('Vozilo s tom registarskom oznakom već postoji.')
})
