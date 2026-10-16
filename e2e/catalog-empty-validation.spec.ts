import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('empty catalog lists and remaining field messages appear on the screens', async ({ page }) => {
  const tenant = await seedTenant('catalog-empty')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const nav = page.getByRole('navigation', { name: 'Odjeljci' })

  await nav.getByRole('link', { name: 'Naručitelji' }).click()
  await expect(page.getByText('Još nema naručitelja. Dodajte prvog.')).toBeVisible()

  await nav.getByRole('link', { name: 'Početna' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Početna' })).toBeVisible()
  await nav.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page.getByText('Još nema lokacija. Dodajte prvu.')).toBeVisible()

  await nav.getByRole('link', { name: 'Početna' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Početna' })).toBeVisible()
  await nav.getByRole('link', { name: 'Vozači' }).click()
  await expect(page.getByText('Još nema vozača.')).toBeVisible()
  await page.getByRole('button', { name: 'Dodaj vozača', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill('Ivo Ivić')
  await dialog.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Vlastiti', exact: true }).click()
  await dialog.getByLabel('Vozačka dozvola vrijedi do').fill('2030-01-01')
  await dialog.getByLabel('Dozvola za prijevoz vrijedi do').fill('2030-02-02')
  await dialog.getByRole('button', { name: 'Dodaj vozača', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Unesite telefon.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()

  await nav.getByRole('link', { name: 'Početna' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Početna' })).toBeVisible()
  await nav.getByRole('link', { name: 'Vozila' }).click()
  await expect(page.getByText('Još nema vozila.')).toBeVisible()
  await page.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Registarska oznaka', { exact: true }).fill('ST333DD')
  await dialog.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Stalno', exact: true }).click()
  await dialog.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'Unesite datum.' })).toHaveCount(3)
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()

  await nav.getByRole('link', { name: 'Početna' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Početna' })).toBeVisible()
  await nav.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByText('Još nema vozača.')).toBeVisible()
})
