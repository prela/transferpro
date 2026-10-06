import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('empty catalog lists and remaining field messages appear on the screens', async ({ page }) => {
  const tenant = await seedTenant('catalog-empty')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  await page.getByRole('link', { name: 'Klijenti' }).click()
  await expect(page.getByText('Još nema klijenata.')).toBeVisible()

  await page.getByRole('link', { name: 'Početna' }).click()
  await page.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page.getByText('Još nema lokacija.')).toBeVisible()

  await page.getByRole('link', { name: 'Početna' }).click()
  await page.getByRole('link', { name: 'Vozači' }).click()
  await expect(page.getByText('Još nema vozača.')).toBeVisible()
  await page.getByLabel('Ime').fill('Ivo Ivić')
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Vlastiti', exact: true }).click()
  await page.getByLabel('Vozačka dozvola vrijedi do').fill('2030-01-01')
  await page.getByLabel('Dozvola za prijevoz vrijedi do').fill('2030-02-02')
  await page.getByRole('button', { name: 'Dodaj vozača', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Unesite telefon.')

  await page.getByRole('link', { name: 'Početna' }).click()
  await page.getByRole('link', { name: 'Vozila' }).click()
  await expect(page.getByText('Još nema vozila.')).toBeVisible()
  await page.getByLabel('Registarska oznaka', { exact: true }).fill('ST333DD')
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Stalno', exact: true }).click()
  await page.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Unesite datum.' })).toHaveCount(3)

  await page.getByRole('link', { name: 'Početna' }).click()
  await page.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByText('Još nema vozača.')).toBeVisible()
})
