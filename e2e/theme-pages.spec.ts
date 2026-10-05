import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { signIn, useTheme } from './fixtures/ui'

for (const theme of ['light', 'dark'] as const) {
  test(`drivers page is usable in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`drivers-theme-${theme}`)
    await useTheme(page, theme)
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.getByRole('link', { name: 'Vozači' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Vozači' })).toBeVisible()
    await expect(page.getByLabel('Ime')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dodaj vozača', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Drivers' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add driver', exact: true })).toBeVisible()
  })

  test(`vehicles page is usable in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`vehicles-theme-${theme}`)
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
