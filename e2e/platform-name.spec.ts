import { expect, test } from '@playwright/test'
import { seedSuperadmin, seedTenant } from './fixtures/seed'

test('renaming a firm with an empty name shows the length message', async ({ page }) => {
  const tenant = await seedTenant('platform-name')
  const owner = await seedSuperadmin('platform-name')

  await page.goto('/')
  await page.getByLabel('E-pošta').fill(owner.email)
  await page.getByLabel('Lozinka').fill(owner.password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toBeVisible()
  await page.getByRole('link', { name: tenant.name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()

  await page.getByLabel('Naziv').fill(' ')
  await page.getByRole('button', { name: 'Preimenuj', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Unesite naziv od najviše 120 znakova.')
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
})
