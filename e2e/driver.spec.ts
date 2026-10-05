import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('a driver cannot open members, settings, or clients', async ({ page }) => {
  const tenant = await seedTenant('driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozač')
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Klijenti' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Članovi' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Spremi', exact: true })).toHaveCount(0)
  await expect(page.getByText('Samo administrator može ovo promijeniti.')).toBeVisible()

  await page.goto('/clients')
  await expect(page.getByRole('alert')).toContainText('Vozač ne može dodavati ni ispravljati klijente.')
  await expect(page.getByRole('heading', { name: 'Dodaj klijenta' })).toHaveCount(0)

  await page.goto('/drivers')
  await expect(page.getByRole('alert')).toContainText('Vozač ne može dodavati ni ispravljati vozače.')
  await expect(page.getByLabel('Ime')).toHaveCount(0)

  await page.goto('/vehicles')
  await expect(page.getByRole('alert')).toContainText('Vozač ne može dodavati ni ispravljati vozila.')
  await expect(page.getByLabel('Registarska oznaka', { exact: true })).toHaveCount(0)

  await page.goto('/roster')
  await expect(page.getByRole('alert')).toContainText('Vozač ne može mijenjati raspored.')
  await expect(page.getByLabel('Datum')).toHaveCount(0)
})
